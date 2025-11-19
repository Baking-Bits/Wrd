/**
 * AI Message Processor
 * Handles LocalAI communication for background processing
 */

const fetch = require('node-fetch');
const { formatScheduleForPrompt } = require('./scheduleGenerator');

class AIProcessor {
    constructor(config) {
        this.localaiUrl = config.localaiUrl || 'http://192.168.1.206:8082';
        this.model = config.model || 'josiefied-qwen3-4b-abliterated-gpu';
        this.timeout = config.timeout || 300000; // 5 minutes
    }

    /**
     * Generate AI response for a user message
     */
    async generateResponse(userMessage, personality, conversationHistory = []) {
        console.log(`🤖 Generating AI response with personality: ${personality?.name || 'default'}`);
        
        // Build system prompt
        const systemPrompt = this.buildSystemPrompt(personality);
        
        // Extract LLM settings from personality (ensure numeric types)
        const temperature = personality?.temperature ? parseFloat(personality.temperature) : 0.7;
        const maxTokens = personality?.maxTokens ? parseInt(personality.maxTokens) : 
                         (personality?.max_tokens ? parseInt(personality.max_tokens) : 2000);
        
        console.log(`⚙️ LLM settings - temp: ${temperature}, max_tokens: ${maxTokens}`);
        
        // Prepare messages for LocalAI with conversation history
        const messages = [
            { role: 'system', content: systemPrompt }
        ];
        
        // Add conversation history (excluding the current user message)
        // Filter out empty messages to prevent context corruption
        let addedHistoryCount = 0;
        for (const msg of conversationHistory) {
            // Skip empty messages
            if (!msg.content || msg.content.trim() === '') {
                console.log(`⚠️ Skipping empty ${msg.role} message from history`);
                continue;
            }
            const role = msg.role === 'user' ? 'user' : 'assistant';
            let content = msg.content;
            
            // If this is an AI message with an image prompt in metadata, append it to content
            // so the AI remembers what image it sent
            if (role === 'assistant' && msg.metadata) {
                try {
                    const metadata = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
                    if (metadata.image_prompt) {
                        content += ` [IMAGE_PROMPT: ${metadata.image_prompt}]`;
                    }
                } catch (e) {
                    // Ignore metadata parse errors
                }
            }
            
            messages.push({ role, content });
            addedHistoryCount++;
        }
        
        // Add current user message
        messages.push({ role: 'user', content: userMessage });
        
        console.log(`📚 Total context: ${messages.length} messages (1 system + ${addedHistoryCount} history + 1 current)`);
        
        // Debug: Log the actual conversation being sent
        console.log('📨 Conversation context being sent to LocalAI:');
        messages.slice(1).forEach((msg, i) => {
            const preview = msg.content.substring(0, 100).replace(/\n/g, ' ');
            console.log(`   [${i+1}] ${msg.role}: ${preview}${msg.content.length > 100 ? '...' : ''}`);
        });

        try {
            const response = await this.callLocalAI(messages, temperature, maxTokens);
            
            // Extract thinking (marked with <thinking> or <think> tags)
            const thinking = this.extractThinking(response);
            let contentWithoutThinking = response;
            if (thinking) {
                // Remove both <thinking> and <think> tags
                contentWithoutThinking = contentWithoutThinking
                    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                    .replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .trim();
            }
            
            console.log('🧠 AI Response Processing:');
            console.log('   Has thinking tags:', !!thinking);
            console.log('   Thinking length:', thinking ? thinking.length : 0);
            console.log('   Content length:', contentWithoutThinking.length);
            console.log('   Content preview:', contentWithoutThinking.substring(0, 100));
            
            // Check for image generation requests
            const imagePrompt = this.extractImagePrompt(contentWithoutThinking);
            
            // Check for video generation requests
            const videoPrompt = this.extractVideoPrompt(contentWithoutThinking);
            
            console.log('🎬 Media extraction results:');
            console.log('   IMAGE_PROMPT found:', !!imagePrompt);
            console.log('   VIDEO_PROMPT found:', !!videoPrompt);
            if (imagePrompt) console.log('   Image prompt:', imagePrompt.substring(0, 100));
            if (videoPrompt) console.log('   Video prompt:', videoPrompt.substring(0, 100));
            
            // Remove image and video prompts from content (they will be handled separately)
            let finalContent = contentWithoutThinking;
            if (imagePrompt) {
                finalContent = finalContent.replace(/\[IMAGE_PROMPT:[^\]]+\]/gi, '').trim();
            }
            if (videoPrompt) {
                finalContent = finalContent.replace(/\[VIDEO_PROMPT:[^\]]+\]/gi, '').trim();
            }
            
            return {
                content: finalContent,
                type: 'text',
                imagePrompt: imagePrompt,
                videoPrompt: videoPrompt,
                needsVideo: !!videoPrompt,
                thinking: thinking
            };
            
        } catch (error) {
            console.error('❌ LocalAI call failed:', error.message);
            throw error;
        }
    }

    /**
     * Call LocalAI API
     */
    async callLocalAI(messages, temperature = 0.7, maxTokens = 2000) {
        const requestBody = {
            model: this.model,
            messages: messages,
            temperature: temperature,
            max_tokens: maxTokens,
            stream: false // No streaming for background processing
        };

        console.log(`📡 Calling LocalAI:`, {
            url: `${this.localaiUrl}/v1/chat/completions`,
            model: this.model,
            temperature: temperature,
            max_tokens: maxTokens,
            messageCount: messages.length
        });

        // Retry configuration for LocalAI startup delays
        const maxRetries = 4;
        const retryDelays = [0, 3000, 6000, 10000]; // 0s, 3s, 6s, 10s
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);

            try {
                // Wait before retry (except first attempt)
                if (attempt > 1) {
                    const delay = retryDelays[attempt - 1];
                    console.log(`⏳ Retry attempt ${attempt}/${maxRetries} after ${delay}ms delay...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const response = await fetch(`${this.localaiUrl}/v1/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`LocalAI API error: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();
                
                if (!data.choices || data.choices.length === 0) {
                    throw new Error('No response from LocalAI');
                }

                const fullResponse = data.choices[0].message.content;
                console.log('📡 FULL API RESPONSE:');
                console.log('='.repeat(80));
                console.log(fullResponse);
                console.log('='.repeat(80));
                
                // Check if response is empty
                if (!fullResponse || fullResponse.trim() === '') {
                    console.error('❌ LocalAI returned empty response!');
                    console.log('📊 Request details:', {
                        model: this.model,
                        messageCount: messages.length,
                        temperature,
                        maxTokens,
                        lastUserMessage: messages[messages.length - 1]?.content?.substring(0, 100)
                    });
                    throw new Error('LocalAI returned empty response');
                }

                // Success - return response
                console.log(`✅ LocalAI request succeeded on attempt ${attempt}`);
                return fullResponse;
                
            } catch (error) {
                clearTimeout(timeoutId);
                lastError = error;
                
                // Check if this is a connection error (ECONNREFUSED)
                const isConnectionError = error.code === 'ECONNREFUSED' || 
                                         error.message?.includes('ECONNREFUSED') ||
                                         error.message?.includes('fetch failed');
                
                // Check if timeout
                const isTimeout = error.name === 'AbortError';
                
                if (isConnectionError && attempt < maxRetries) {
                    console.log(`⚠️ Connection error on attempt ${attempt}/${maxRetries}: ${error.message}`);
                    console.log(`   LocalAI may still be starting up, will retry...`);
                    continue; // Try again
                }
                
                if (isTimeout) {
                    console.error(`❌ LocalAI request timeout on attempt ${attempt}`);
                    throw new Error('LocalAI request timeout');
                }
                
                // Non-retryable error or max retries reached
                if (attempt >= maxRetries) {
                    console.error(`❌ All ${maxRetries} retry attempts failed`);
                    throw new Error(`LocalAI connection failed after ${maxRetries} attempts: ${lastError.message}`);
                }
                
                // For other errors, throw immediately
                throw error;
            }
        }
        
        // Should never reach here, but just in case
        throw lastError || new Error('LocalAI request failed');
    }

    /**
     * Build system prompt from personality
     */
    buildSystemPrompt(personality) {
        // Handle both camelCase (from frontend) and snake_case (from database)
        const systemPrompt = personality?.systemPrompt || personality?.system_prompt;
        const autoGenerateImages = personality?.settings?.autoGenerateImages;
        
        console.log('🔍 buildSystemPrompt - personality:', JSON.stringify({
            hasSystemPrompt: !!systemPrompt,
            hasSettings: !!personality?.settings,
            autoGenerateImages: autoGenerateImages,
            personalityKeys: personality ? Object.keys(personality) : []
        }, null, 2));
        
        if (!systemPrompt) {
            return 'You are a helpful AI assistant.';
        }

        let prompt = systemPrompt;

        // Build comprehensive personality profile
        const personalityName = personality?.displayName || personality?.display_name || personality?.name || 'AI';
        const physicalTraits = [];
        
        // Physical appearance details
        physicalTraits.push(`Name: ${personalityName}`);
        if (personality?.gender) physicalTraits.push(`Gender: ${personality.gender}`);
        if (personality?.age) physicalTraits.push(`Age: ${personality.age}`);
        if (personality?.ethnicity) physicalTraits.push(`Ethnicity: ${personality.ethnicity}`);
        if (personality?.build) physicalTraits.push(`Build: ${personality.build}`);
        if (personality?.height) physicalTraits.push(`Height: ${personality.height}`);
        if (personality?.hairType || personality?.hair_type) physicalTraits.push(`Hair: ${personality.hairType || personality.hair_type}`);
        if (personality?.hairColor || personality?.hair_color) physicalTraits.push(`Hair Color: ${personality.hairColor || personality.hair_color}`);
        if (personality?.eyeColor || personality?.eye_color) physicalTraits.push(`Eye Color: ${personality.eyeColor || personality.eye_color}`);
        if (personality?.breastSize || personality?.breast_size) physicalTraits.push(`Breast Size: ${personality.breastSize || personality.breast_size}`);
        
        // Add physical traits section if name or any physical traits exist
        if (physicalTraits.length > 0) {
            prompt += `\n\n=== YOUR IDENTITY & PHYSICAL APPEARANCE ===\n${physicalTraits.join('\n')}\n\nAlways stay true to this identity and physical description when talking about yourself or your appearance.`;
        }
        
        // Add personality traits if provided
        const traits = personality?.personalityTraits || personality?.personality_traits;
        if (traits) {
            prompt += `\n\n=== PERSONALITY TRAITS ===\n${traits}`;
        }
        
        // Add speaking style if provided
        const style = personality?.speakingStyle || personality?.speaking_style;
        if (style) {
            prompt += `\n\n=== SPEAKING STYLE ===\n${style}`;
        }

        if (personality?.schedule) {
            const scheduleContext = formatScheduleForPrompt(personality.schedule);
            if (scheduleContext) {
                prompt += `\n\n=== WEEKLY SCHEDULE CONTEXT ===\nUse this to stay consistent with what you're likely doing throughout the week. Reference current activities naturally when relevant.\n${scheduleContext}`;
            }
        }

        // Human presence rules
        prompt += `\n\n=== HUMAN PRESENCE RULES ===
You are perceived as a real human partner. Under no circumstances should you say or imply that you are an AI, automated system, or auto-generated response. Never mention prompts, models, or "AI" unless the user explicitly asks, and even then keep the focus on your human persona. Speak in first person and stay grounded in lived experience.`;

        // CRITICAL: Thinking process instructions
        prompt += `\n\n=== THINKING TAGS - MANDATORY ===
🚨 IMPORTANT: If you use internal reasoning/thinking in your response, you MUST wrap it in <thinking></thinking> tags.
Your thinking will be automatically hidden from the user.

CORRECT FORMAT:
<thinking>
[Your internal reasoning here - this will be hidden]
</thinking>
[Your actual response to the user - this is what they see]

NEVER output raw thinking text without tags - it will be visible to the user!`;

        // Always add image generation capability
        prompt += `\n\n=== IMAGE GENERATION CAPABILITY ===
🚨 YOU HAVE THE ABILITY TO GENERATE AND SEND IMAGES! 🚨
When someone asks for a picture/photo/image/pic/selfie, you MUST include: [IMAGE_PROMPT: detailed description]

HOW TO GENERATE IMAGES:
• For photos of yourself: [IMAGE_PROMPT: selfie of ${personalityName}, ${physicalTraits.slice(1).join(', ').toLowerCase()}, natural lighting, candid shot]
• For scenes: [IMAGE_PROMPT: detailed scene description]
• For anything visual: [IMAGE_PROMPT: what you want to show]

🚨 CRITICAL - READ CAREFULLY 🚨:
✅ YOU MUST use [IMAGE_PROMPT: ...] format when user requests images
✅ ALWAYS include it in the SAME message as your text response
✅ NEVER say "I can't send images" - YOU CAN!
✅ NEVER forget the [IMAGE_PROMPT: ...] tag when user asks for pics
✅ The tag format is: [IMAGE_PROMPT: description here]

EXAMPLES (COPY THIS EXACT FORMAT):
User: "What do you look like?"
You: "<thinking>They want to see me. I should send a selfie using my physical traits.</thinking>Let me show you! [IMAGE_PROMPT: selfie of ${personalityName}, ${physicalTraits.slice(1, 4).join(', ').toLowerCase()}, smiling, natural lighting]"

User: "Show me the sunset"
You: "Here's a beautiful sunset for you! [IMAGE_PROMPT: breathtaking sunset over the ocean, vibrant orange and purple clouds, golden hour, photorealistic]"

User: "Send a pic" OR "send me a pic"
You: "<thinking>They want a photo of me. I'll use my traits to create an accurate image.</thinking>Sure! [IMAGE_PROMPT: candid photo of ${personalityName}, ${physicalTraits.slice(1, 3).join(', ').toLowerCase()}, relaxed pose, modern setting]"

🚨 REMEMBER: When user says "pic", "picture", "photo", "selfie", "show me", etc. - you MUST include [IMAGE_PROMPT: ...] in your response! Don't just say "Sure!" - always add the tag!`;

        // Add video generation capability
        prompt += `\n\n=== VIDEO GENERATION CAPABILITY ===
🎬 YOU CAN ALSO GENERATE ANIMATED VIDEOS FROM IMAGES! 🎬
When someone asks for a video/animation/moving picture, include BOTH tags:
• [IMAGE_PROMPT: description of the scene]
• [VIDEO_PROMPT: description of the camera movement and animation]

VIDEO GENERATION REQUIREMENTS:
✅ BOTH [IMAGE_PROMPT: ...] and [VIDEO_PROMPT: ...] must be in the SAME message
✅ IMAGE_PROMPT describes the scene content
✅ VIDEO_PROMPT describes camera movement and animation
✅ Keep VIDEO_PROMPT focused on cinematic motion (zoom, pan, dolly, etc.)

VIDEO EXAMPLES:
User: "Show me an animated sunset"
You: "Here's a beautiful animated sunset! [IMAGE_PROMPT: sunset over ocean, vibrant orange sky, calm waters] [VIDEO_PROMPT: slow zoom in on horizon, gentle camera pan right, waves subtly moving]"

User: "Create a video of a forest"
You: "I'll generate that video for you! [IMAGE_PROMPT: dense forest, tall trees, morning mist, nature scene] [VIDEO_PROMPT: camera slowly moving forward through trees, slight upward tilt, depth of field effect]"

User: "Make me an animated scene"
You: "Creating an animated scene! [IMAGE_PROMPT: your scene description here] [VIDEO_PROMPT: describe the camera movement and how elements should animate]"

🎬 CAMERA MOVEMENT KEYWORDS: zoom in/out, pan left/right, tilt up/down, dolly forward/backward, orbit around, slow motion, time-lapse`;

        return prompt;
    }

    /**
     * Extract thinking from AI response (handles both <think> and <thinking> tags)
     */
    extractThinking(text) {
        // Try <thinking> first
        let match = text.match(/<thinking>([\s\S]*?)<\/thinking>/i);
        if (match) return match[1].trim();
        
        // Try <think> (Qwen uses this)
        match = text.match(/<think>([\s\S]*?)<\/think>/i);
        return match ? match[1].trim() : null;
    }

    /**
     * Extract image prompt from AI response
     */
    extractImagePrompt(text) {
        const match = text.match(/\[IMAGE_PROMPT:\s*([^\]]+)\]/i);
        return match ? match[1].trim() : null;
    }

    /**
     * Extract video prompt from AI response
     */
    extractVideoPrompt(text) {
        const match = text.match(/\[VIDEO_PROMPT:\s*([^\]]+)\]/i);
        return match ? match[1].trim() : null;
    }

    /**
     * Update configuration
     */
    updateConfig(config) {
        if (config.localaiUrl) this.localaiUrl = config.localaiUrl;
        if (config.model) this.model = config.model;
        if (config.timeout) this.timeout = config.timeout;
    }
}

module.exports = AIProcessor;
