const database = require('./database');
const config = require('./config');
const { formatScheduleForPrompt } = require('./scheduleGenerator');

/**
 * Auto Message Scheduler - Sends periodic messages from AI personalities
 * Creates the illusion of an active relationship with automated check-ins
 */
class AutoMessageScheduler {
    constructor(messageQueue, aiProcessor, imageGenerator, db) {
        this.messageQueue = messageQueue;
        this.aiProcessor = aiProcessor;
        this.imageGenerator = imageGenerator;
        this.db = db;
        this.checkInterval = 30 * 60 * 1000; // Check every 30 minutes
        this.minIdleTime = 30 * 60 * 1000; // 30 minutes minimum idle time
        this.maxIdleTime = 10 * 60 * 60 * 1000; // 10 hours maximum idle time
        this.extendedAutoCooldown = 10 * 60 * 60 * 1000; // 10 hours after two unanswered autos
        this.timer = null;
        this.isRunning = false;
        
        // Track last auto-message per chat to avoid spam
        this.lastAutoMessage = new Map(); // chatId -> timestamp
        this.lastScenarioByChat = new Map();
        this.scheduleCache = new Map();
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
                    MAX(CASE WHEN m.role = 'user' THEN m.created_at END) as last_user_message_time,
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

                    console.log(`   Chat ${chat.chat_id} (${chat.display_name}):`);
                    console.log(`      Last message: ${chat.last_message_time} (${new Date(chat.last_message_time).toLocaleString()})`);
                    console.log(`      Now: ${new Date(now).toLocaleString()}`);
                    console.log(`      Idle: ${Math.round(idleTime/1000/60)}min, Recent msgs: ${chat.recent_message_count}`);

                    // Skip if they've been actively chatting recently (2+ messages in last 2 hours)
                    if (chat.recent_message_count > 2 && idleTime < this.minIdleTime) {
                        console.log(`   ⏭️  Skipped: active chatting (${chat.recent_message_count} msgs in 2h)`);
                        continue;
                    }

                    // Add randomization: 1-5 minutes idle time required (varies per chat, testing)
                    const randomMinIdleTime = this.minIdleTime + Math.random() * (4 * 60 * 1000); // 1-5 minutes
                    
                    // Skip if not enough idle time from ANYONE'S last message
                    if (idleTime < randomMinIdleTime) {
                        console.log(`   ⏭️  Skipped: not enough idle time (need ${Math.round(randomMinIdleTime/1000/60)}min)`);
                        continue;
                    }

                    // Skip if too much idle time (user probably not interested)
                    if (idleTime > this.maxIdleTime) {
                        console.log(`   ⏭️  Skipped: too much idle time (${Math.round(idleTime/1000/60)}min > ${Math.round(this.maxIdleTime/1000/60)}min)`);
                        continue;
                    }

                    // Skip if we sent an auto-message recently (prevent spam)
                    // Require at least the minimum time since last auto-message
                    if (timeSinceLastAuto < this.minIdleTime) {
                        console.log(`   ⏭️  Skipped: auto-message sent recently (${Math.round(timeSinceLastAuto/1000/60)}min ago)`);
                        continue;
                    }

                    const context = await this.getChatContext(connection, chat.chat_id);
                    const lastUserMessageTime = chat.last_user_message_time ? new Date(chat.last_user_message_time).getTime() : null;
                    const timeSinceLastUser = lastUserMessageTime ? now - lastUserMessageTime : Infinity;

                    if (context.autoStreak >= 2 && timeSinceLastUser < this.extendedAutoCooldown) {
                        const waitHours = Math.ceil((this.extendedAutoCooldown - timeSinceLastUser) / (60 * 60 * 1000));
                        console.log(`   ⏭️  Skipped: ${context.autoStreak} auto-messages unanswered. Waiting at least ${waitHours}h more.`);
                        continue;
                    }

                    console.log(`   💬 Sending auto-message for chat ${chat.chat_id} (idle: ${Math.round(idleTime / 1000 / 60)}min, auto streak: ${context.autoStreak})`);
                    await this.sendAutoMessage(chat, context);
                    
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
    async sendAutoMessage(chat, context = {}) {
        try {
            // Randomly decide between text message or image (80% text, 20% image)
            const shouldSendImage = Math.random() < 0.20 && (context.autoStreak || 0) === 0;

            if (shouldSendImage) {
                // Send an image
                await this.sendAutoImage(chat, context);
            } else {
                // Send a text message
                await this.sendAutoText(chat, context);
            }

        } catch (error) {
            console.error(`❌ Failed to send auto-message for chat ${chat.chat_id}:`, error);
            throw error;
        }
    }

    /**
     * Send automated text message
     */
    async sendAutoText(chat, context = {}, forceScenario = null) {
        const scheduleContext = await this.getScheduleContext(chat.personality_id, chat.user_id);
        const previousScenario = this.lastScenarioByChat.get(chat.chat_id);
        const scenario = this.pickScenario({
            scheduleAvailable: Boolean(scheduleContext),
            hasRecentUserMessage: Boolean(context.lastUserMessage),
            previousScenario,
            forceScenario
        });

        const autoPrompt = this.generateAutoMessagePrompt({
            scenario,
            lastUserMessage: context.lastUserMessage,
            scheduleContext
        });

        const conversationSnippet = this.buildConversationSnippet(context.recentMessages);
        const guidanceSections = [
            `${chat.system_prompt}`,
            `You are ${chat.display_name}. Keep every outreach personal, human, and varied. Avoid reusing exact phrases from earlier auto-messages, and never mention AI, automation, or prompts.`,
            scenario.instruction,
            'Aim for 1-3 sentences unless the situation calls for more. Include small sensory or situational clues when possible.'
        ];

        if (scenario.type === 'schedule' && scheduleContext) {
            guidanceSections.push(`Schedule context you can reference naturally:\n${scheduleContext}`);
        }

        if (conversationSnippet) {
            guidanceSections.push(`Recent chat snippets for continuity:\n${conversationSnippet}`);
        }

        const systemPrompt = guidanceSections.join('\n\n');
        const temperature = this.determineAutoTemperature(chat.temperature);

        console.log(`📤 Queuing auto-text message for chat ${chat.chat_id} (scenario: ${scenario.type})`);

        await this.messageQueue.addJob({
            type: 'ai_message',
            isAutoMessage: true,
            data: {
                chatId: chat.chat_id,
                userId: chat.user_id,
                userMessage: autoPrompt,
                personality: {
                    id: chat.personality_id,
                    displayName: chat.display_name,
                    systemPrompt,
                    temperature
                },
                db: this.db,
                aiProcessor: this.aiProcessor,
                imageGenerator: this.imageGenerator,
                autoScenario: scenario.type,
                isAutoMessage: true
            }
        });

        this.lastScenarioByChat.set(chat.chat_id, scenario.type);
    }

    /**
     * Send automated image (selfie/photo)
     */
    async sendAutoImage(chat, context = {}) {
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
            isAutoMessage: true,
            data: {
                chatId: chat.chat_id,
                userId: chat.user_id,
                prompt: fullPrompt,
                isAutoMessage: true
            }
        });

        this.lastScenarioByChat.set(chat.chat_id, 'image');

        if (Math.random() < 0.65) {
            await this.sendAutoText(chat, context, 'image_followup');
        }
    }

    /**
     * Generate a prompt for auto-message based on random scenario
     */
    parseMetadata(value) {
        if (!value) {
            return {};
        }
        if (typeof value === 'object') {
            return value;
        }
        try {
            return JSON.parse(value);
        } catch (error) {
            return {};
        }
    }

    truncateText(text, max = 200) {
        if (!text) {
            return '';
        }
        if (text.startsWith('data:image')) {
            return '[image]';
        }
        const cleaned = text.replace(/\s+/g, ' ').trim();
        if (!cleaned) {
            return '';
        }
        if (cleaned.length > max) {
            return `${cleaned.slice(0, max - 1)}…`;
        }
        return cleaned;
    }

    buildConversationSnippet(messages = []) {
        if (!messages.length) {
            return '';
        }
        const recent = messages.slice(-4);
        const lines = recent.map(msg => {
            const label = msg.role === 'user' ? 'User' : 'You';
            const preview = this.truncateText(msg.content);
            if (!preview) {
                return null;
            }
            return `${label}: ${preview}`;
        }).filter(Boolean);
        return lines.join('\n');
    }

    async getChatContext(connection, chatId) {
        const context = {
            autoStreak: 0,
            recentMessages: [],
            lastUserMessage: null
        };

        try {
            const [rows] = await connection.execute(`
                SELECT role, content, metadata, created_at
                FROM messages
                WHERE chat_id = ?
                ORDER BY created_at DESC
                LIMIT 8
            `, [chatId]);

            let streak = 0;
            for (const row of rows) {
                const metadata = this.parseMetadata(row.metadata);
                if (row.role === 'assistant' && metadata.auto) {
                    streak++;
                    continue;
                }
                break;
            }

            const normalizedRows = rows.map(r => ({
                ...r,
                content: typeof r.content === 'string' ? r.content : (r.content ? r.content.toString('utf8') : '')
            }));

            const lastUserRow = normalizedRows.find(r => r.role === 'user');
            context.autoStreak = streak;
            context.lastUserMessage = lastUserRow ? lastUserRow.content : null;
            context.recentMessages = normalizedRows.reverse();
        } catch (error) {
            console.warn(`⚠️ Failed to load chat context for ${chatId}:`, error.message);
        }

        return context;
    }

    pickScenario(options = {}) {
        const {
            scheduleAvailable = false,
            hasRecentUserMessage = false,
            previousScenario = null,
            forceScenario = null
        } = options;

        const scenarioPool = [
            {
                type: 'check_in',
                weight: 3,
                instruction: 'Offer a warm, human check-in that shows you genuinely notice how long it has been.',
                buildPrompt: () => 'Check on how they are feeling right now and invite them to share anything new happening today.'
            },
            {
                type: 'continuation',
                weight: 2,
                requiresRecent: true,
                instruction: 'Reference their last message naturally so it feels like a continuation, not a reset.',
                buildPrompt: ({ lastUserMessage }) => lastUserMessage
                    ? `Continue the conversation by responding to their last message: "${lastUserMessage}". Acknowledge it and add something new.`
                    : 'Check in with them as if you are continuing the earlier chat.'
            },
            {
                type: 'schedule',
                weight: 2,
                requiresSchedule: true,
                instruction: 'Share what you are currently doing, grounded in your weekly schedule, so it feels like real life is happening.',
                buildPrompt: ({ scheduleContext }) => `Talk about what you are doing right now according to your schedule. Use this as inspiration and keep it grounded: ${scheduleContext || ''}`
            },
            {
                type: 'story',
                weight: 2,
                instruction: 'Share a short slice-of-life story or detail about what you are experiencing, with sensory color.',
                buildPrompt: () => 'Share a quick story about what you are doing or thinking right now. Include at least one sensory detail.'
            },
            {
                type: 'image_tease',
                weight: 1,
                instruction: 'Mention snapping or sending a quick picture, and describe the vibe so it feels playful.',
                buildPrompt: () => 'Tell them you just snapped a quick photo or are about to send one, and describe what it looks like in a flirty, casual way.'
            },
            {
                type: 'random_question',
                weight: 1,
                instruction: 'Ask a thoughtful or playful question that sparks conversation and feels different from normal check-ins.',
                buildPrompt: () => 'Ask them an offbeat but caring question that invites a story or opinion. Tie it to something you might actually be thinking about.'
            },
            {
                type: 'image_followup',
                forceOnly: true,
                instruction: 'Caption the picture you just sent and ask what they think, keeping it light and human.',
                buildPrompt: () => 'You just sent them a photo. Give it a short caption, share what you were doing, and ask what they think.'
            }
        ];

        const findScenario = (type) => scenarioPool.find(s => s.type === type);

        if (forceScenario) {
            const forced = findScenario(forceScenario);
            if (forced && (!forced.requiresSchedule || scheduleAvailable) && (!forced.requiresRecent || hasRecentUserMessage)) {
                return forced;
            }
        }

        let candidates = scenarioPool.filter(s => !s.forceOnly);
        candidates = candidates.filter(s => (
            (!s.requiresSchedule || scheduleAvailable) &&
            (!s.requiresRecent || hasRecentUserMessage)
        ));

        if (!candidates.length) {
            candidates = scenarioPool.filter(s => !s.forceOnly);
        }

        if (previousScenario && candidates.length > 1) {
            candidates = candidates.filter(s => s.type !== previousScenario);
        }

        const totalWeight = candidates.reduce((sum, scenario) => sum + (scenario.weight || 1), 0);
        let pick = Math.random() * totalWeight;
        for (const scenario of candidates) {
            pick -= (scenario.weight || 1);
            if (pick <= 0) {
                return scenario;
            }
        }

        return candidates[0] || scenarioPool[0];
    }

    generateAutoMessagePrompt({ scenario, lastUserMessage, scheduleContext }) {
        if (!scenario) {
            return 'Check in with them in a caring way and share a quick update about yourself.';
        }

        if (typeof scenario.buildPrompt === 'function') {
            return scenario.buildPrompt({ lastUserMessage, scheduleContext }) || 'Say hello and share something warm.';
        }

        return 'Reach out with a human, specific note that feels new.';
    }

    determineAutoTemperature(baseTemperature) {
        const parsed = typeof baseTemperature === 'number' ? baseTemperature : parseFloat(baseTemperature);
        const base = Number.isFinite(parsed) ? parsed : 0.8;
        const variance = (Math.random() * 0.2) - 0.1;
        return Math.min(1.1, Math.max(0.4, base + variance));
    }

    async getScheduleContext(personalityId, userId) {
        if (!personalityId || !userId) {
            return null;
        }

        const cacheKey = `${personalityId}:${userId}`;
        const cached = this.scheduleCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < 60 * 60 * 1000) {
            return cached.value;
        }

        try {
            const record = await this.db.personalities.getPersonalitySchedule(personalityId, userId);
            if (record?.schedule) {
                const formatted = formatScheduleForPrompt(record.schedule);
                const trimmed = formatted && formatted.length > 1200 ? `${formatted.slice(0, 1200)}…` : formatted;
                this.scheduleCache.set(cacheKey, { value: trimmed, timestamp: Date.now() });
                return trimmed;
            }
        } catch (error) {
            console.warn('⚠️ Failed to retrieve personality schedule:', error.message);
        }

        this.scheduleCache.set(cacheKey, { value: null, timestamp: Date.now() });
        return null;
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
