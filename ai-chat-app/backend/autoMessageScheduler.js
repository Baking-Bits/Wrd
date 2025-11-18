const database = require('./database');
const config = require('./config');

/**
 * Auto Message Scheduler - Sends periodic messages from AI personalities
 * Creates the illusion of an active relationship with automated check-ins
 */
class AutoMessageScheduler {
    constructor(messageQueue) {
        this.messageQueue = messageQueue;
        this.checkInterval = 1 * 60 * 1000; // Check every 1 minute (testing)
        this.minIdleTime = 1 * 60 * 1000; // 1 minute of inactivity before auto-message (testing)
        this.maxIdleTime = 4 * 60 * 60 * 1000; // 4 hours max idle time
        this.timer = null;
        this.isRunning = false;
        
        // Track last auto-message per chat to avoid spam
        this.lastAutoMessage = new Map(); // chatId -> timestamp
    }

    /**
     * Start the auto-message scheduler
     */
    start() {
        if (this.isRunning) {
            console.log('⏰ Auto-message scheduler already running');
            return;
        }

        console.log('⏰ Starting auto-message scheduler...');
        console.log(`   - Check interval: ${this.checkInterval / 1000 / 60} minutes`);
        console.log(`   - Min idle time: ${this.minIdleTime / 1000 / 60} minutes`);
        console.log(`   - Max idle time: ${this.maxIdleTime / 1000 / 60 / 60} hours`);
        
        this.isRunning = true;
        this.scheduleNextCheck();
    }

    /**
     * Stop the auto-message scheduler
     */
    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.isRunning = false;
        console.log('⏰ Auto-message scheduler stopped');
    }

    /**
     * Schedule next check
     */
    scheduleNextCheck() {
        if (!this.isRunning) return;

        this.timer = setTimeout(async () => {
            try {
                await this.checkAndSendAutoMessages();
            } catch (error) {
                console.error('❌ Auto-message check error:', error);
            }
            this.scheduleNextCheck();
        }, this.checkInterval);
    }

    /**
     * Check all active chats and send auto-messages where appropriate
     */
    async checkAndSendAutoMessages() {
        let connection = null;
        try {
            connection = database.getConnection();
            if (!connection) {
                console.warn('⚠️ Database not connected, skipping auto-message check');
                return;
            }

            // Test connection and reconnect if needed
            try {
                await connection.ping();
            } catch (pingError) {
                console.warn('⚠️ Database connection lost, attempting to reconnect...');
                try {
                    await database.initializeDatabase();
                    connection = database.getConnection();
                    if (!connection) {
                        console.error('❌ Failed to reconnect to database');
                        return;
                    }
                    console.log('✅ Database reconnected successfully');
                } catch (reconnectError) {
                    console.error('❌ Database reconnection failed:', reconnectError.message);
                    return;
                }
            }

            // Get all chats with their last message time and message counts
            const [chats] = await connection.execute(`
                SELECT 
                    c.id as chat_id,
                    c.user_id,
                    c.personality_id,
                    c.updated_at,
                    p.display_name,
                    p.system_prompt,
                    p.temperature,
                    p.gender,
                    p.age,
                    p.build,
                    p.hair_type,
                    p.hair_color,
                    p.eye_color,
                    p.height,
                    p.ethnicity,
                    MAX(m.created_at) as last_message_time,
                    (SELECT COUNT(*) FROM messages WHERE chat_id = c.id AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)) as recent_message_count
                FROM chats c
                LEFT JOIN personalities p ON c.personality_id = p.id
                LEFT JOIN messages m ON c.id = m.chat_id
                WHERE c.personality_id IS NOT NULL
                GROUP BY c.id
                HAVING last_message_time IS NOT NULL
            `);

            console.log(`⏰ Checking ${chats.length} active chats for auto-messages...`);

            const now = Date.now();
            let messagesSent = 0;

            for (const chat of chats) {
                try {
                    const lastMessageTime = new Date(chat.last_message_time).getTime();
                    const idleTime = now - lastMessageTime;
                    const lastAutoTime = this.lastAutoMessage.get(chat.chat_id) || 0;
                    const timeSinceLastAuto = now - lastAutoTime;

                    // Skip if they've been actively chatting recently (2+ messages in last 2 hours)
                    if (chat.recent_message_count > 2 && idleTime < this.minIdleTime) {
                        continue;
                    }

                    // Add randomization: 1-5 minutes idle time required (varies per chat, testing)
                    const randomMinIdleTime = this.minIdleTime + Math.random() * (4 * 60 * 1000); // 1-5 minutes
                    
                    // Skip if not enough idle time from ANYONE'S last message
                    if (idleTime < randomMinIdleTime) {
                        continue;
                    }

                    // Skip if too much idle time (user probably not interested)
                    if (idleTime > this.maxIdleTime) {
                        continue;
                    }

                    // Skip if we sent an auto-message recently (prevent spam)
                    // Require at least the minimum time since last auto-message
                    if (timeSinceLastAuto < this.minIdleTime) {
                        continue;
                    }

                    // Send auto-message (text or image randomly)
                    console.log(`💬 Sending auto-message for chat ${chat.chat_id} (idle: ${Math.round(idleTime / 1000 / 60)}min, recent msgs: ${chat.recent_message_count})`);
                    await this.sendAutoMessage(chat);
                    
                    this.lastAutoMessage.set(chat.chat_id, now);
                    messagesSent++;

                    // Add small delay between messages to avoid overwhelming the queue
                    await new Promise(resolve => setTimeout(resolve, 2000));

                } catch (chatError) {
                    console.error(`❌ Error processing chat ${chat.chat_id}:`, chatError.message);
                }
            }

            if (messagesSent > 0) {
                console.log(`✅ Sent ${messagesSent} auto-messages`);
            }

        } catch (error) {
            // Handle database connection errors gracefully
            if (error.code === 'PROTOCOL_CONNECTION_LOST' || 
                error.code === 'ECONNREFUSED' ||
                error.message?.includes('closed state')) {
                console.error('❌ Database connection error, will retry on next check:', error.message);
            } else {
                console.error('❌ Auto-message check failed:', error);
            }
        }
    }

    /**
     * Send an automated message for a chat
     */
    async sendAutoMessage(chat) {
        try {
            // Randomly decide between text message or image (80% text, 20% image)
            const shouldSendImage = Math.random() < 0.20;

            if (shouldSendImage) {
                // Send an image
                await this.sendAutoImage(chat);
            } else {
                // Send a text message
                await this.sendAutoText(chat);
            }

        } catch (error) {
            console.error(`❌ Failed to send auto-message for chat ${chat.chat_id}:`, error);
            throw error;
        }
    }

    /**
     * Send automated text message
     */
    async sendAutoText(chat) {
        // Generate prompt for auto-message based on personality
        const autoPrompt = this.generateAutoMessagePrompt(chat.display_name);

        // Create message context with personality
        const messages = [
            {
                role: 'system',
                content: `${chat.system_prompt}\n\nYou are ${chat.display_name}. Send a casual, natural message to your partner as if you're thinking of them. Keep it brief (1-3 sentences). ${autoPrompt}`
            },
            {
                role: 'user',
                content: '(Send a spontaneous message)'
            }
        ];

        // Send to LocalAI via message queue
        console.log(`📤 Queuing auto-text message for chat ${chat.chat_id}`);
        
        // Queue the AI response
        await this.messageQueue.queueMessage({
            chatId: chat.chat_id,
            userId: chat.user_id,
            userMessage: '(auto-generated)',
            messages: messages,
            temperature: chat.temperature || 0.8,
            isAutoMessage: true
        });
    }

    /**
     * Send automated image (selfie/photo)
     */
    async sendAutoImage(chat) {
        console.log(`📸 Sending auto-image for chat ${chat.chat_id}`);

        // Generate a selfie/photo prompt based on personality
        const imagePrompts = [
            "Taking a casual selfie right now, natural lighting, candid moment",
            "Quick photo of what I'm doing, casual and spontaneous",
            "Selfie in my current outfit, full body mirror shot, casual style",
            "Just took a photo, natural expression, warm lighting",
            "Sending you a quick pic, casual pose, genuine smile"
        ];

        const selectedPrompt = imagePrompts[Math.floor(Math.random() * imagePrompts.length)];

        // Build the full prompt with personality physical traits
        let fullPrompt = selectedPrompt;
        
        // Add physical description if available
        const physicalTraits = [];
        if (chat.gender) physicalTraits.push(chat.gender);
        if (chat.age) physicalTraits.push(`${chat.age} years old`);
        if (chat.ethnicity) physicalTraits.push(chat.ethnicity);
        if (chat.hair_color && chat.hair_type) physicalTraits.push(`${chat.hair_color} ${chat.hair_type} hair`);
        if (chat.eye_color) physicalTraits.push(`${chat.eye_color} eyes`);
        if (chat.build) physicalTraits.push(`${chat.build} build`);
        if (chat.height) physicalTraits.push(chat.height);
        
        if (physicalTraits.length > 0) {
            fullPrompt += `, ${physicalTraits.join(', ')}`;
        }

        // Queue image generation
        await this.messageQueue.addJob({
            type: 'image_generation',
            chatId: chat.chat_id,
            userId: chat.user_id,
            prompt: fullPrompt,
            isAutoMessage: true
        });
    }

    /**
     * Generate a prompt for auto-message based on random scenario
     */
    generateAutoMessagePrompt(personalityName) {
        const prompts = [
            "You're thinking about your partner and want to reach out. Share something about what you're doing right now or what's on your mind.",
            "You just had an interesting thought or experience and want to tell your partner about it. Keep it casual and affectionate.",
            "You're wondering what your partner is up to. Ask them about their day in a caring, natural way.",
            "You found something interesting or funny and want to share it. Could be a fun fact, observation, or just a random thought.",
            "You're feeling affectionate and want to let your partner know you're thinking of them. Be sweet but not over the top.",
            "You just finished doing something (cooking, reading, watching something, etc.) and want to share about it briefly.",
            "You noticed something interesting in your surroundings and want to tell your partner about it.",
            "You remembered something from your conversation earlier and want to follow up on it.",
            "You're curious about what your partner is doing and want to check in casually.",
            "You have a random question or observation you want to share. Be playful and engaging."
        ];

        return prompts[Math.floor(Math.random() * prompts.length)];
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            checkInterval: this.checkInterval,
            minIdleTime: this.minIdleTime,
            maxIdleTime: this.maxIdleTime,
            activeAutoChats: this.lastAutoMessage.size
        };
    }
}

module.exports = AutoMessageScheduler;
