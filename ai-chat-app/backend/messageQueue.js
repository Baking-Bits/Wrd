/**
 * Message Queue System for Background Processing
 * Handles async message processing even when client disconnects
 */

const EventEmitter = require('events');

class MessageQueue extends EventEmitter {
    constructor() {
        super();
        this.queue = new Map(); // jobId -> job details
        this.activeJobs = new Set(); // Currently processing job IDs
        this.completedJobs = new Map(); // jobId -> result (kept for 5 minutes)
        this.maxConcurrent = 1; // Process ONE job at a time for VRAM management
        this.currentService = null; // Track which service is currently running (localai/a1111)
        this.dockerManager = null; // Will be set externally
    }

    /**
     * Add a message processing job to the queue
     */
    async addJob(jobData) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const job = {
            id: jobId,
            ...jobData,
            status: 'queued',
            createdAt: Date.now(),
            startedAt: null,
            completedAt: null,
            error: null
        };

        this.queue.set(jobId, job);
        console.log(`📬 Job ${jobId} queued:`, jobData.type);
        console.log(`📊 Queue status: ${this.queue.size} jobs, ${this.activeJobs.size} active`);
        
        // Try to process immediately if not at max capacity
        setImmediate(() => this.processNext());
        
        return jobId;
    }

    /**
     * Process the next job in the queue
     */
    async processNext() {
        console.log(`🔍 processNext called - Active: ${this.activeJobs.size}, Queue: ${this.queue.size}`);
        
        // Check if we're at max concurrent jobs
        if (this.activeJobs.size >= this.maxConcurrent) {
            console.log(`⏸️ Max concurrent jobs (${this.maxConcurrent}) reached, waiting...`);
            return;
        }

        // PRIORITY SYSTEM: Video > Image > AI message
        const queuedJobs = Array.from(this.queue.values())
            .filter(job => job.status === 'queued')
            .sort((a, b) => {
                // Priority 1: Video generation (highest - long-running)
                if (a.type === 'video_generation' && b.type !== 'video_generation') return -1;
                if (b.type === 'video_generation' && a.type !== 'video_generation') return 1;
                // Priority 2: Image generation
                if (a.type === 'image_generation' && b.type !== 'image_generation') return -1;
                if (b.type === 'image_generation' && a.type !== 'image_generation') return 1;
                // Priority 3: Order of creation (FIFO)
                return a.createdAt - b.createdAt;
            });

        console.log(`📋 Found ${queuedJobs.length} queued jobs`);
        
        const nextJob = queuedJobs[0];

        if (!nextJob) {
            console.log(`⏭️ No jobs to process`);
            return; // No jobs to process
        }
        
        console.log(`🎯 Processing next job: ${nextJob.id} (${nextJob.type})`);


        // Start processing
        nextJob.status = 'processing';
        nextJob.startedAt = Date.now();
        this.activeJobs.add(nextJob.id);
        
        console.log(`🚀 Starting job ${nextJob.id}:`, nextJob.type);
        this.emit('jobStarted', nextJob);

        try {
            // VRAM MANAGEMENT: Switch services if needed
            await this.switchService(nextJob.type);
            
            // Process the job
            const result = await this.processJob(nextJob);
            
            // Mark as completed
            nextJob.status = 'completed';
            nextJob.completedAt = Date.now();
            nextJob.result = result;
            this.completedJobs.set(nextJob.id, nextJob);
            
            console.log(`✅ Job ${nextJob.id} completed in ${(nextJob.completedAt - nextJob.startedAt) / 1000}s`);
            this.emit('jobCompleted', nextJob);
            
            // Auto-cleanup after 5 minutes
            setTimeout(() => {
                this.queue.delete(nextJob.id);
                this.completedJobs.delete(nextJob.id);
            }, 5 * 60 * 1000);
            
        } catch (error) {
            // Mark as failed
            nextJob.status = 'failed';
            nextJob.completedAt = Date.now();
            nextJob.error = error.message;
            
            console.error(`❌ Job ${nextJob.id} failed:`, error.message);
            this.emit('jobFailed', nextJob, error);
        } finally {
            // Remove from active jobs
            this.activeJobs.delete(nextJob.id);
            this.queue.delete(nextJob.id);
            
            // Try to process next job
            this.processNext();
        }
    }

    /**
     * Process a specific job based on its type
     */
    async processJob(job) {
        switch (job.type) {
            case 'ai_message':
                return await this.processAIMessage(job);
            case 'image_generation':
                return await this.processImageGeneration(job);
            case 'avatar_generation':
                return await this.processAvatarGeneration(job);
            case 'video_generation':
                return await this.processVideoGeneration(job);
            default:
                throw new Error(`Unknown job type: ${job.type}`);
        }
    }

    /**
     * Process AI message generation
     */
    async processAIMessage(job) {
        const { chatId, userId, userMessage, personality, db, aiProcessor } = job.data;
        
        console.log(`🤖 Processing AI message for chat ${chatId}`);
        
        try {
            // Load conversation history (last 10 messages)
            const history = await db.chats.getChatMessages(chatId, userId);
            
            // Filter out empty messages AND image-type messages (images shouldn't go to AI)
            // Only text messages should be in conversation context
            const filteredHistory = history.filter(msg => {
                // Skip if empty
                if (!msg.content || msg.content.trim() === '') return false;
                
                // Skip if it's an image message - check metadata for type
                if (msg.metadata) {
                    try {
                        const metadata = typeof msg.metadata === 'string' ? JSON.parse(msg.metadata) : msg.metadata;
                        if (metadata.type === 'image') return false;
                    } catch (e) {
                        // If metadata parse fails, check if content looks like base64 image
                        if (msg.content.startsWith('data:image/')) return false;
                    }
                }
                
                // Also check if content starts with base64 image data (fallback)
                if (msg.content.startsWith('data:image/')) return false;
                
                return true;
            });
            const recentHistory = filteredHistory.slice(-10);
            
            console.log(`📚 Loading ${recentHistory.length} messages as conversation history (filtered from ${history.length} total)`);
            
            if (history.length !== filteredHistory.length) {
                const emptyCount = history.filter(m => !m.content || !m.content.trim()).length;
                const imageCount = history.filter(m => {
                    if (m.content && m.content.startsWith('data:image/')) return true;
                    if (m.metadata) {
                        try {
                            const meta = typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata;
                            return meta.type === 'image';
                        } catch (e) {
                            return false;
                        }
                    }
                    return false;
                }).length;
                console.log(`⚠️ Filtered out ${history.length - filteredHistory.length} messages: ${emptyCount} empty, ${imageCount} images`);
            }
            
            // Call AI service with conversation history
            const aiResponse = await aiProcessor.generateResponse(userMessage, personality, recentHistory);
            
            console.log('📝 Saving to DB:');
            console.log('   Content length:', aiResponse.content.length);
            console.log('   Has thinking:', !!aiResponse.thinking);
            console.log('   Thinking in metadata:', aiResponse.thinking ? 'YES' : 'NO');
            console.log('   Has image prompt:', !!aiResponse.imagePrompt);
            console.log('   Image prompt:', aiResponse.imagePrompt || 'none');
            console.log('   Content preview:', aiResponse.content.substring(0, 150));
            console.log('   Content contains <think>:', aiResponse.content.includes('<think>'));
            console.log('   Content contains <thinking>:', aiResponse.content.includes('<thinking>'));
            
            // Check if response is empty
            if (!aiResponse.content || aiResponse.content.trim() === '') {
                console.error('❌ AI returned empty response! Not saving to DB.');
                console.log('📊 Conversation history that led to empty response:', recentHistory.map(m => ({
                    role: m.role,
                    contentLength: m.content?.length || 0,
                    hasContent: !!m.content?.trim()
                })));
                throw new Error('AI generated empty response');
            }
            
            // Save AI response to database
            const messageId = await db.chats.addMessage(
                chatId,
                'assistant',
                aiResponse.content,
                {
                    type: aiResponse.type || 'text',
                    thinking: aiResponse.thinking,
                    timestamp: Date.now()
                }
            );
            
            console.log(`💾 AI response saved to DB: message ${messageId}`);
            
            // Check if image or video generation is needed
            if (aiResponse.imagePrompt && aiResponse.imagePrompt.trim()) {
                if (aiResponse.needsVideo) {
                    console.log(`🎬 Queueing image→video pipeline`);
                    console.log(`   Image prompt: "${aiResponse.imagePrompt}"`);
                    console.log(`   Video prompt: "${aiResponse.videoPrompt}"`);
                    
                    // Queue image generation with video chaining
                    await this.addJob({
                        type: 'image_generation',
                        data: {
                            chatId,
                            userId,
                            prompt: aiResponse.imagePrompt,
                            db,
                            imageGenerator: job.data.imageGenerator,
                            chainToVideo: true,
                            videoPrompt: aiResponse.videoPrompt,
                            videoGenerator: job.data.videoGenerator
                        }
                    });
                } else {
                    console.log(`🎨 Queueing image generation: "${aiResponse.imagePrompt}"`);
                    
                    // Queue image generation as separate job
                    await this.addJob({
                        type: 'image_generation',
                        data: {
                            chatId,
                            userId,
                            prompt: aiResponse.imagePrompt,
                            db,
                            imageGenerator: job.data.imageGenerator
                        }
                    });
                }
            }
            
            return {
                messageId,
                content: aiResponse.content,
                hasImage: !!aiResponse.imagePrompt
            };
            
        } catch (error) {
            console.error('❌ AI message processing failed:', error);
            
            // Save error message to DB
            await db.chats.addMessage(
                chatId,
                'assistant',
                `I apologize, but I encountered an error processing your message: ${error.message}`,
                { type: 'text', error: true, timestamp: Date.now() }
            );
            
            throw error;
        }
    }

    /**
     * Process image generation
     */
    async processImageGeneration(job) {
        const { chatId, userId, prompt, db, imageGenerator, chainToVideo, videoPrompt, videoGenerator } = job.data;
        
        console.log(`🎨 Generating image for chat ${chatId}: "${prompt}"`);
        if (chainToVideo) {
            console.log(`   This image will be chained to video generation`);
        }
        
        try {
            // Generate image
            const imageResult = await imageGenerator.generate(prompt);
            
            // If chaining to video, don't save image - pass directly to video generator
            if (chainToVideo && videoGenerator) {
                console.log(`🎬 Image generated, now chaining to video generation`);
                
                // Queue video generation with the generated image
                await this.addJob({
                    type: 'video_generation',
                    data: {
                        chatId,
                        userId,
                        base64Image: imageResult.base64Image,
                        videoPrompt: videoPrompt || '',
                        imagePrompt: prompt,
                        db,
                        videoGenerator
                    }
                });
                
                return {
                    imageData: imageResult.base64Image,
                    chainedToVideo: true
                };
            }
            
            // Save image to database (standalone image, not part of video pipeline)
            const messageId = await db.chats.addMessage(
                chatId,
                'assistant',
                imageResult.base64Image,
                {
                    type: 'image',
                    prompt: prompt,
                    timestamp: Date.now()
                }
            );
            
            console.log(`🖼️ Image saved to DB: message ${messageId}`);
            
            return {
                messageId,
                imageData: imageResult.base64Image
            };
            
        } catch (error) {
            console.error('❌ Image generation failed:', error);
            
            // Don't save error for images - just log it
            throw error;
        }
    }

    /**
     * Process video generation from image
     */
    async processVideoGeneration(job) {
        const { chatId, userId, base64Image, videoPrompt, imagePrompt, db, videoGenerator } = job.data;
        
        console.log(`🎬 Generating video for chat ${chatId}`);
        console.log(`   Image prompt: "${imagePrompt}"`);
        console.log(`   Video prompt: "${videoPrompt}"`);
        
        try {
            // Generate video from image
            const videoResult = await videoGenerator.generate(base64Image, videoPrompt);
            
            // Save video to database
            const messageId = await db.chats.addMessage(
                chatId,
                'assistant',
                videoResult.videoData,
                {
                    type: 'video',
                    image_prompt: imagePrompt,
                    video_prompt: videoPrompt,
                    timestamp: Date.now()
                }
            );
            
            console.log(`🎬 Video saved to DB: message ${messageId}`);
            
            return {
                messageId,
                videoData: videoResult.videoData
            };
            
        } catch (error) {
            console.error('❌ Video generation failed:', error);
            
            // Save error message
            await db.chats.addMessage(
                chatId,
                'assistant',
                `Video generation failed: ${error.message}`,
                { type: 'error', timestamp: Date.now() }
            );
            
            throw error;
        }
    }

    /**
     * Process avatar generation for personality
     */
    async processAvatarGeneration(job) {
        const { personalityId, personalityName, userId, prompt, db, imageGenerator } = job.data;
        
        console.log(`🎨 Generating avatar for personality "${personalityName}" (ID: ${personalityId})`);
        
        try {
            // Generate image
            const imageResult = await imageGenerator.generate(prompt);
            
            // Update personality with avatar data
            const { query } = require('./database/postgres');
            await query(
                'UPDATE personalities SET avatar_data = $1, avatar_prompt = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4',
                [imageResult.base64Image, prompt, personalityId, userId]
            );
            
            console.log(`✅ Avatar saved to personality ${personalityId}`);
            
            return {
                personalityId,
                avatarData: imageResult.base64Image
            };
            
        } catch (error) {
            console.error('❌ Avatar generation failed:', error);
            throw error;
        }
    }

    /**
     * Get job status
     */
    getJobStatus(jobId) {
        // Check active queue
        if (this.queue.has(jobId)) {
            return this.queue.get(jobId);
        }
        
        // Check completed jobs
        if (this.completedJobs.has(jobId)) {
            return this.completedJobs.get(jobId);
        }
        
        return null;
    }

    /**
     * Get all jobs for a specific chat
     */
    getJobsForChat(chatId) {
        const jobs = [];
        
        // Active jobs
        for (const job of this.queue.values()) {
            if (job.data.chatId === chatId) {
                jobs.push(job);
            }
        }
        
        // Completed jobs
        for (const job of this.completedJobs.values()) {
            if (job.data.chatId === chatId) {
                jobs.push(job);
            }
        }
        
        return jobs.sort((a, b) => a.createdAt - b.createdAt);
    }

    /**
     * Get queue statistics
     */
    getStats() {
        return {
            queued: Array.from(this.queue.values()).filter(j => j.status === 'queued').length,
            processing: this.activeJobs.size,
            completed: this.completedJobs.size,
            maxConcurrent: this.maxConcurrent,
            currentService: this.currentService
        };
    }

    /**
     * Manage A1111 container for VRAM optimization (LocalAI stays running)
     */
    async switchService(jobType) {
        const targetService = jobType === 'image_generation' ? 'a1111' : 'localai';
        
        // Already on correct service
        if (this.currentService === targetService) {
            console.log(`✅ Already using ${targetService.toUpperCase()}`);
            return;
        }

        console.log(`🔄 Switching to: ${targetService.toUpperCase()}`);

        try {
            // STEP 1: Manage A1111 container
            if (targetService === 'a1111') {
                // Start A1111 for image generation
                console.log('🚀 Starting A1111...');
                if (this.dockerManager) {
                    await this.dockerManager.startContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI');
                    console.log('✅ A1111 started, waiting for initialization...');
                    // Wait for A1111 to be ready
                    await new Promise(resolve => setTimeout(resolve, 30000));
                }
            } else {
                // Stop A1111 when switching back to LocalAI
                console.log('⏸️ Stopping A1111 to free VRAM...');
                if (this.dockerManager) {
                    await this.dockerManager.stopContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI');
                    console.log('✅ A1111 stopped');
                    // Wait 5 seconds for VRAM to release before using LocalAI
                    console.log('⏳ Waiting 5 seconds for VRAM to release...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    console.log('✅ VRAM released, LocalAI ready to use');
                }
            }

            // Update current service
            this.currentService = targetService;
            console.log(`✅ Service switch complete: ${targetService.toUpperCase()} is now active`);

        } catch (error) {
            console.error(`❌ Service switch error:`, error.message);
            // Continue anyway - service might already be running
        }
    }

    /**
     * Shutdown A1111 gracefully (LocalAI stays running)
     */
    async shutdownAll() {
        console.log('🛑 Shutting down A1111...');
        
        try {
            if (this.dockerManager) {
                await this.dockerManager.stopContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI').catch(e => console.log('A1111 already stopped'));
            }
            this.currentService = null;
            console.log('✅ A1111 stopped (LocalAI remains running)');
        } catch (error) {
            console.error('Error during shutdown:', error.message);
        }
    }

    /**
     * Set Docker manager instance
     */
    setDockerManager(dockerManager) {
        this.dockerManager = dockerManager;
        console.log('✅ Docker manager connected to message queue');
    }

    /**
     * Queue a message for processing (for auto-message scheduler)
     */
    async queueMessage(messageData) {
        const { chatId, userId, userMessage, messages, temperature, isAutoMessage } = messageData;
        
        console.log(`💬 Queueing ${isAutoMessage ? 'auto-' : ''}message for chat ${chatId}`);
        
        return await this.addJob({
            type: 'ai_message',
            chatId,
            userId,
            userMessage,
            messages,
            temperature,
            isAutoMessage: isAutoMessage || false
        });
    }
}

// Singleton instance
const messageQueue = new MessageQueue();

module.exports = messageQueue;
