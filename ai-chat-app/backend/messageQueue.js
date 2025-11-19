/**
 * Message Queue System for Background Processing
 * Handles async message processing even when client disconnects
 */

const EventEmitter = require('events');
const pushService = require('./pushService');

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
            error: null,
            skipCount: 0 // Track how many times this job was skipped for batching
        };

        this.queue.set(jobId, job);
        console.log(`📬 Job ${jobId} queued:`, jobData.type);
        console.log(`📊 Queue status: ${this.queue.size} jobs, ${this.activeJobs.size} active`);
        
        // Try to process immediately if not at max capacity
        setImmediate(() => this.processNext());
        
        return jobId;
    }

    /**
     * Calculate priority score for a job (higher = more urgent)
     */
    calculatePriority(job) {
        const ageMinutes = (Date.now() - job.createdAt) / 60000;
        
        // Base priority by type
        let basePriority = 0;
        if (job.type === 'video_generation') basePriority = 100;
        else if (job.type === 'image_generation') basePriority = 50;
        else basePriority = 25; // ai_message
        
        // Add age bonus (1 point per minute waiting)
        const agePriority = ageMinutes;
        
        // Add skip penalty (10 points per skip - becomes urgent quickly)
        const skipPenalty = job.skipCount * 10;
        
        return basePriority + agePriority + skipPenalty;
    }

    /**
     * Check if switching to a target service would be expensive
     */
    needsExpensiveSwitch(targetType) {
        const targetService = this.mapJobTypeToService(targetType);
        
        // LocalAI jobs require stopping A1111/ComfyUI (expensive: ~35s)
        if (targetService === 'localai' && (this.currentService === 'a1111' || this.currentService === 'comfyui')) {
            return true;
        }
        
        // A1111 ↔ ComfyUI switch (expensive: ~35s)
        if (targetService === 'a1111' && this.currentService === 'comfyui') return true;
        if (targetService === 'comfyui' && this.currentService === 'a1111') return true;
        
        return false;
    }

    /**
     * Map job type to service name
     */
    mapJobTypeToService(jobType) {
        if (jobType === 'image_generation') return 'a1111';
        if (jobType === 'video_generation') return 'comfyui';
        return 'localai';
    }

    /**
     * Process the next job in the queue with smart batching
     */
    async processNext() {
        console.log(`🔍 processNext called - Active: ${this.activeJobs.size}, Queue: ${this.queue.size}`);
        
        // Check if we're at max concurrent jobs
        if (this.activeJobs.size >= this.maxConcurrent) {
            console.log(`⏸️ Max concurrent jobs (${this.maxConcurrent}) reached, waiting...`);
            return;
        }

        const queuedJobs = Array.from(this.queue.values())
            .filter(job => job.status === 'queued');

        if (queuedJobs.length === 0) {
            console.log(`⏭️ No jobs to process`);
            return;
        }

        // Sort by priority score
        queuedJobs.sort((a, b) => this.calculatePriority(b) - this.calculatePriority(a));
        
        const firstJob = queuedJobs[0];
        let selectedJob = firstJob;
        
        // SMART BATCHING: If switching would be expensive, check if we can skip to a same-service job
        // But only if the first job hasn't been skipped too many times (max 2 skips)
        if (this.needsExpensiveSwitch(firstJob.type) && firstJob.skipCount < 2) {
            // Look for a job that uses the current service (no switch needed)
            const sameServiceJob = queuedJobs.find(job => {
                const jobService = this.mapJobTypeToService(job.type);
                return jobService === this.currentService;
            });
            
            if (sameServiceJob) {
                console.log(`🔄 Smart batching: Skipping job ${firstJob.id} (${firstJob.type}) to avoid expensive switch`);
                console.log(`   → Processing job ${sameServiceJob.id} (${sameServiceJob.type}) instead (same service: ${this.currentService})`);
                firstJob.skipCount++;
                selectedJob = sameServiceJob;
            } else {
                console.log(`🎯 Processing highest priority job: ${firstJob.id} (${firstJob.type}, priority: ${this.calculatePriority(firstJob).toFixed(1)})`);
            }
        } else {
            if (firstJob.skipCount > 0) {
                console.log(`⚠️ Job ${firstJob.id} was skipped ${firstJob.skipCount} times - processing now (priority: ${this.calculatePriority(firstJob).toFixed(1)})`);
            } else {
                console.log(`🎯 Processing job: ${firstJob.id} (${firstJob.type}, priority: ${this.calculatePriority(firstJob).toFixed(1)})`);
            }
        }

        // Start processing
        selectedJob.status = 'processing';
        selectedJob.startedAt = Date.now();
        this.activeJobs.add(selectedJob.id);
        
        console.log(`🚀 Starting job ${selectedJob.id}:`, selectedJob.type);
        this.emit('jobStarted', selectedJob);

        try {
            // VRAM MANAGEMENT: Switch services if needed
            await this.switchService(selectedJob.type);
            
            // Process the job
            const result = await this.processJob(selectedJob);
            
            // Mark as completed
            selectedJob.status = 'completed';
            selectedJob.completedAt = Date.now();
            selectedJob.result = result;
            this.completedJobs.set(selectedJob.id, selectedJob);
            
            console.log(`✅ Job ${selectedJob.id} completed in ${(selectedJob.completedAt - selectedJob.startedAt) / 1000}s`);
            this.emit('jobCompleted', selectedJob);
            
            // Auto-cleanup after 5 minutes
            setTimeout(() => {
                this.queue.delete(selectedJob.id);
                this.completedJobs.delete(selectedJob.id);
            }, 5 * 60 * 1000);
            
        } catch (error) {
            // Mark as failed
            selectedJob.status = 'failed';
            selectedJob.completedAt = Date.now();
            selectedJob.error = error.message;
            
            console.error(`❌ Job ${selectedJob.id} failed:`, error.message);
            this.emit('jobFailed', selectedJob, error);
        } finally {
            // Remove from active jobs
            this.activeJobs.delete(selectedJob.id);
            this.queue.delete(selectedJob.id);
            
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
        
        // Ensure we're switched to LocalAI (stops A1111/ComfyUI if running)
        await this.switchService('LOCALAI');
        
        try {
            let resolvedPersonality = personality;
            if (!resolvedPersonality || !resolvedPersonality.id) {
                const chatRecord = await db.chats.getChatById(chatId, userId);
                if (chatRecord?.personality_id) {
                    resolvedPersonality = await db.personalities.getPersonalityById(chatRecord.personality_id, userId);
                }
            }

            if (resolvedPersonality && !resolvedPersonality.schedule && resolvedPersonality.id) {
                try {
                    const scheduleRecord = await db.personalities.getPersonalitySchedule(resolvedPersonality.id, userId);
                    if (scheduleRecord?.schedule) {
                        resolvedPersonality = { ...resolvedPersonality, schedule: scheduleRecord.schedule };
                    }
                } catch (scheduleError) {
                    console.warn('⚠️ Failed to attach schedule to personality:', scheduleError.message);
                }
            }

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
            const aiResponse = await aiProcessor.generateResponse(userMessage, resolvedPersonality || personality, recentHistory);
            
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
            const isAutoMessage = job.isAutoMessage === true || job.data?.isAutoMessage === true;
            const autoScenario = job.data?.autoScenario || null;

            const messageId = await db.chats.addMessage(
                chatId,
                'assistant',
                aiResponse.content,
                {
                    type: aiResponse.type || 'text',
                    thinking: aiResponse.thinking,
                    timestamp: Date.now(),
                    auto: isAutoMessage,
                    autoScenario
                }
            );
            
            console.log(`💾 AI response saved to DB: message ${messageId}`);

            const preview = aiResponse.content.replace(/\s+/g, ' ').trim().slice(0, 160);
            const personalityName = resolvedPersonality?.display_name || resolvedPersonality?.displayName || resolvedPersonality?.name || 'AI Companion';
            pushService.notifyAiMessage({
                userId,
                chatId,
                messageId,
                personalityName,
                messagePreview: preview,
                messageType: aiResponse.type || 'text'
            }).catch(pushError => {
                console.warn('⚠️ Push notification failed:', pushError.message);
            });
            
            // Check if image or video generation is needed
            if (aiResponse.imagePrompt && aiResponse.imagePrompt.trim()) {
                console.log(`🔍 Image generation needed. needsVideo: ${aiResponse.needsVideo}, hasVideoPrompt: ${!!aiResponse.videoPrompt}`);
                if (aiResponse.needsVideo) {
                    console.log(`🎬 Queueing image→video pipeline`);
                    console.log(`   Image prompt: "${aiResponse.imagePrompt}"`);
                    console.log(`   Video prompt: "${aiResponse.videoPrompt}"`);
                    console.log(`   videoGenerator available: ${!!job.data.videoGenerator}`);
                    
                    // Queue image generation with video chaining
                    await this.addJob({
                        type: 'image_generation',
                        data: {
                            chatId,
                            userId,
                            prompt: aiResponse.imagePrompt,
                            db,
                            imageGenerator: job.data.imageGenerator,
                            videoGenerator: job.data.videoGenerator,
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
        const isAutoMessage = job.isAutoMessage === true || job.data?.isAutoMessage === true;
        
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
                    isAutoMessage: job.isAutoMessage === true,
                    data: {
                        chatId,
                        userId,
                        base64Image: imageResult.base64Image,
                        videoPrompt: videoPrompt || '',
                        imagePrompt: prompt,
                        db,
                        videoGenerator,
                        isAutoMessage: job.isAutoMessage === true
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
                    timestamp: Date.now(),
                    auto: isAutoMessage
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
            // Switch to ComfyUI (stop A1111 if running)
            await this.switchService('COMFYUI');
            
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
                    timestamp: Date.now(),
                    auto: job.isAutoMessage === true || job.data?.isAutoMessage === true
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
        
        // Ensure we're switched to A1111 for image generation
        await this.switchService('A1111');
        
        try {
            // Generate image
            const imageResult = await imageGenerator.generate(prompt);
            
            // Save to pending_avatars table (not personality table yet)
            await db.pendingAvatars.savePendingAvatar(personalityId, userId, imageResult.base64Image, prompt);
            
            console.log(`✅ Avatar generated and saved to pending table for personality ${personalityId}`);
            
            return {
                personalityId,
                avatarUrl: imageResult.base64Image,
                pendingApproval: true
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
     * Manage A1111/ComfyUI containers for VRAM optimization
     * 
     * Called BETWEEN jobs (never during processing) since queue is sequential (maxConcurrent=1)
     * 
     * VRAM Rules:
     * - LocalAI: Needs VRAM to load model, releases VRAM when idle - STAYS RUNNING ALWAYS (container never stops)
     * - A1111: Holds VRAM exclusively while running - must stop for LocalAI to load
     * - ComfyUI: Holds VRAM exclusively while running - must stop for LocalAI to load
     * - ALL services need exclusive VRAM access when loading/active
     * 
     * Switching Logic:
     * - LocalAI jobs: Stop A1111 OR ComfyUI (whichever is running) so LocalAI can load model
     * - A1111 jobs: Stop ComfyUI if running (leave LocalAI running - it releases VRAM when idle)
     * - ComfyUI jobs: Stop A1111 if running (leave LocalAI running - it releases VRAM when idle)
     */
    async switchService(jobType) {
        // Map job type to target service
        let targetService;
        if (jobType === 'image_generation') {
            targetService = 'a1111';
        } else if (jobType === 'video_generation' || jobType === 'COMFYUI') {
            targetService = 'comfyui';
        } else {
            targetService = 'localai';
        }
        
        // Check if we're already using the right service
        if (this.currentService === targetService) {
            console.log(`✅ Already using ${targetService.toUpperCase()}, no switch needed`);
            return;
        }

        console.log(`🔄 Switching from ${this.currentService ? this.currentService.toUpperCase() : 'NONE'} to ${targetService.toUpperCase()}`);

        try {
            // STEP 1: Stop conflicting services based on target
            
            if (targetService === 'localai') {
                // Switching to LocalAI for chat - stop image services to free VRAM
                if (this.currentService === 'a1111') {
                    console.log('⏸️ Stopping A1111 (switching to LocalAI for chat)...');
                    if (this.dockerManager) {
                        await this.dockerManager.stopContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI');
                        console.log('✅ A1111 stopped');
                        console.log('⏳ Waiting 5 seconds for VRAM to release...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                } else if (this.currentService === 'comfyui') {
                    console.log('⏸️ Stopping ComfyUI (switching to LocalAI for chat)...');
                    if (this.dockerManager) {
                        await this.dockerManager.stopContainer('ComfyUI-Nvidia-Docker');
                        console.log('✅ ComfyUI stopped');
                        console.log('⏳ Waiting 5 seconds for VRAM to release...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
            } else if (targetService === 'a1111') {
                // Switching to A1111 for image generation - stop ComfyUI only (LocalAI stays running)
                if (this.currentService === 'comfyui') {
                    console.log('⏸️ Stopping ComfyUI (switching to A1111)...');
                    if (this.dockerManager) {
                        await this.dockerManager.stopContainer('ComfyUI-Nvidia-Docker');
                        console.log('✅ ComfyUI stopped');
                        console.log('⏳ Waiting 5 seconds for VRAM to release...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
                // LocalAI stays running - it's for chat, not images
            } else if (targetService === 'comfyui') {
                // Switching to ComfyUI for video - stop A1111 only (LocalAI stays running)
                if (this.currentService === 'a1111') {
                    console.log('⏸️ Stopping A1111 (switching to ComfyUI)...');
                    if (this.dockerManager) {
                        await this.dockerManager.stopContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI');
                        console.log('✅ A1111 stopped');
                        console.log('⏳ Waiting 5 seconds for VRAM to release...');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                }
                // LocalAI stays running - it's for chat, not images
            }
            
            // STEP 2: Start/ensure the target service is running
            if (targetService === 'a1111') {
                console.log('🚀 Starting A1111...');
                if (this.dockerManager) {
                    await this.dockerManager.startContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI');
                    console.log('✅ A1111 started, waiting for initialization...');
                    await new Promise(resolve => setTimeout(resolve, 30000));
                }
            } else if (targetService === 'comfyui') {
                console.log('🚀 Starting ComfyUI...');
                if (this.dockerManager) {
                    await this.dockerManager.startContainer('ComfyUI-Nvidia-Docker');
                    console.log('✅ ComfyUI started, waiting for initialization...');
                    await new Promise(resolve => setTimeout(resolve, 15000));
                }
            } else if (targetService === 'localai') {
                // LocalAI - ensure container is running (should always be)
                console.log('🚀 Ensuring LocalAI container is running...');
                if (this.dockerManager) {
                    try {
                        await this.dockerManager.ensureContainerRunning('localai');
                        console.log('✅ LocalAI container is running');
                        // No long wait needed - retry logic in aiProcessor will handle API warmup
                    } catch (error) {
                        console.error('❌ Failed to ensure LocalAI container is running:', error.message);
                        throw error;
                    }
                } else {
                    console.log('✅ LocalAI ready (Docker management disabled)');
                }
            }

            // Update current service tracker
            this.currentService = targetService;
            console.log(`✅ Service switch complete: now using ${targetService.toUpperCase()}`);

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

    /**
     * Queue avatar generation for a personality
     */
    async queueAvatarGeneration(personalityId, prompt, userId) {
        console.log(`🎭 Queueing avatar generation for personality ${personalityId}`);
        
        // Get required dependencies
        const db = require('./database');
        const config = require('./config');
        const ImageGenerator = require('./imageGenerator');
        const imageGenerator = new ImageGenerator({
            a1111Url: config.ai.automatic1111.url,
            dockerManager: this.dockerManager,
            timeout: 600000
        });
        
        // Get personality details
        const personalities = await db.personalities.getUserPersonalities(userId);
        const personality = personalities.find(p => p.id === personalityId);
        
        if (!personality) {
            throw new Error(`Personality ${personalityId} not found`);
        }
        
        const jobId = await this.addJob({
            type: 'avatar_generation',
            data: {
                personalityId,
                personalityName: personality.displayName || personality.name,
                userId,
                prompt,
                db,
                imageGenerator
            }
        });

        return jobId;
    }

    /**
     * Get avatar generation status for a personality
     */
    async getAvatarStatus(personalityId) {
        // Check queue for pending jobs
        for (const job of this.queue.values()) {
            if (job.type === 'avatar_generation' && job.data.personalityId === personalityId) {
                return {
                    status: job.status,
                    jobId: job.id,
                    progress: job.progress || 0
                };
            }
        }

        // Check active jobs
        for (const jobId of this.activeJobs) {
            const job = this.queue.get(jobId);
            if (job && job.type === 'avatar_generation' && job.data.personalityId === personalityId) {
                return {
                    status: 'processing',
                    jobId: job.id,
                    progress: job.progress || 50
                };
            }
        }

        // Check recently completed jobs
        for (const job of this.completedJobs.values()) {
            if (job.type === 'avatar_generation' && job.data.personalityId === personalityId) {
                return {
                    status: job.status,
                    jobId: job.id,
                    progress: 100,
                    result: job.result,
                    avatarUrl: job.result?.avatarUrl || null,
                    pendingApproval: true
                };
            }
        }

        // No active job found
        return {
            status: 'idle',
            jobId: null,
            progress: 0
        };
    }
}

// Singleton instance
const messageQueue = new MessageQueue();

module.exports = messageQueue;
