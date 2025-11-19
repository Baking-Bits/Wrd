const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const config = require('./config');

const dbTimezone = config.database.timezone || '+00:00';
const isoTimezoneSuffix = dbTimezone === '+00:00' || dbTimezone === 'Z' ? 'Z' : dbTimezone;

function toIsoTimestamp(value) {
    if (!value) return null;

    const hasTimezone = (str) => /([zZ]|[+\-]\d{2}:?\d{2})$/.test(str);

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'string') {
        const normalized = value.includes('T') ? value : value.replace(' ', 'T');
        const candidate = hasTimezone(normalized) ? normalized : `${normalized}${isoTimezoneSuffix}`;
        const date = new Date(candidate);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Database configuration from centralized config
const dbConfig = {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    charset: 'utf8mb4',
    timezone: dbTimezone
};

let connection = null;

/**
 * Initialize database connection and create tables
 */
async function initializeDatabase() {
    try {
        console.log('🗄️ Connecting to MariaDB...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to MariaDB database: ChatterRave');
        if (dbTimezone && dbTimezone !== 'local') {
            const tzSetting = dbTimezone === 'Z' ? '+00:00' : dbTimezone;
            await connection.execute('SET time_zone = ?', [tzSetting]);
            console.log(`🕒 MySQL session time_zone set to ${tzSetting}`);
        }
        
        // Create tables if they don't exist
        await createTables();
        console.log('✅ Database tables ready');
        
        // Run migrations for existing tables
        await migrateTables();
        
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        return false;
    }
}

/**
 * Migrate existing tables to add missing columns
 */
async function migrateTables() {
    try {
        // Check if gender column exists in personalities table
        const [columns] = await connection.execute(`
            SHOW COLUMNS FROM personalities LIKE 'gender'
        `);
        
        // If column doesn't exist, add all physical appearance columns
        if (columns.length === 0) {
            console.log('🔄 Adding physical appearance columns to personalities table...');
            await connection.execute(`
                ALTER TABLE personalities
                ADD COLUMN gender VARCHAR(50) AFTER max_tokens,
                ADD COLUMN age INT AFTER gender,
                ADD COLUMN build VARCHAR(50) AFTER age,
                ADD COLUMN hair_type VARCHAR(100) AFTER build,
                ADD COLUMN hair_color VARCHAR(50) AFTER hair_type,
                ADD COLUMN eye_color VARCHAR(50) AFTER hair_color,
                ADD COLUMN breast_size VARCHAR(20) AFTER eye_color,
                ADD COLUMN height VARCHAR(50) AFTER breast_size,
                ADD COLUMN ethnicity VARCHAR(50) AFTER height,
                ADD COLUMN personality_traits TEXT AFTER ethnicity,
                ADD COLUMN speaking_style VARCHAR(100) AFTER personality_traits
            `);
            console.log('✅ Physical appearance columns added successfully');
        }

        // Ensure chats table has last_read_at column
        const [lastReadColumns] = await connection.execute(`
            SHOW COLUMNS FROM chats LIKE 'last_read_at'
        `);

        if (lastReadColumns.length === 0) {
            console.log('🔄 Adding last_read_at column to chats table...');
            await connection.execute(`
                ALTER TABLE chats
                ADD COLUMN last_read_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at
            `);
            // Initialize new column so legacy chats don't appear unread forever
            await connection.execute(`
                UPDATE chats SET last_read_at = updated_at WHERE last_read_at IS NULL
            `);
            console.log('✅ last_read_at column added successfully');
        }

        // Check if pending_avatars table exists and if avatar_url is MEDIUMTEXT
        const [tables] = await connection.execute(`
            SHOW TABLES LIKE 'pending_avatars'
        `);
        
        if (tables.length > 0) {
            const [avatarUrlColumn] = await connection.execute(`
                SHOW COLUMNS FROM pending_avatars LIKE 'avatar_url'
            `);
            
            if (avatarUrlColumn.length > 0 && avatarUrlColumn[0].Type === 'text') {
                console.log('🔄 Upgrading pending_avatars.avatar_url to MEDIUMTEXT...');
                await connection.execute(`
                    ALTER TABLE pending_avatars 
                    MODIFY COLUMN avatar_url MEDIUMTEXT NOT NULL
                `);
                console.log('✅ pending_avatars.avatar_url upgraded successfully');
            }
        }
    } catch (error) {
        // If error is that column already exists, that's fine
        if (error.code !== 'ER_DUP_FIELDNAME') {
            console.error('⚠️ Migration warning:', error.message);
        }
    }
}

/**
 * Create database tables
 */
async function createTables() {
    const tables = [
        // Users table
        `CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL,
            is_active BOOLEAN DEFAULT TRUE,
            INDEX idx_email (email),
            INDEX idx_username (username)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Personalities table
        `CREATE TABLE IF NOT EXISTS personalities (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            name VARCHAR(100) NOT NULL,
            display_name VARCHAR(100) NOT NULL,
            description TEXT,
            system_prompt TEXT NOT NULL,
            avatar_url MEDIUMTEXT,
            temperature DECIMAL(3,2) DEFAULT 0.7,
            max_tokens INT DEFAULT 2000,
            gender VARCHAR(50),
            age INT,
            build VARCHAR(50),
            hair_type VARCHAR(100),
            hair_color VARCHAR(50),
            eye_color VARCHAR(50),
            breast_size VARCHAR(20),
            height VARCHAR(50),
            ethnicity VARCHAR(50),
            personality_traits TEXT,
            speaking_style VARCHAR(100),
            is_default BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Chats table
        `CREATE TABLE IF NOT EXISTS chats (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            title VARCHAR(255) NOT NULL,
            personality_id INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_read_at TIMESTAMP NULL DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (personality_id) REFERENCES personalities(id) ON DELETE SET NULL,
            INDEX idx_user_id (user_id),
            INDEX idx_created_at (created_at),
            INDEX idx_last_read (last_read_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Messages table
        `CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            chat_id INT NOT NULL,
            role ENUM('user', 'assistant', 'system') NOT NULL,
            content MEDIUMTEXT NOT NULL,
            metadata JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
            INDEX idx_chat_id (chat_id),
            INDEX idx_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // User settings table
        `CREATE TABLE IF NOT EXISTS user_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            setting_key VARCHAR(255) NOT NULL,
            setting_value JSON,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY unique_user_setting (user_id, setting_key),
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Sessions table for JWT token management
        `CREATE TABLE IF NOT EXISTS user_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45),
            user_agent TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_id (user_id),
            INDEX idx_token_hash (token_hash),
            INDEX idx_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Pending avatars table for holding generated avatars before user approval
        `CREATE TABLE IF NOT EXISTS pending_avatars (
            id INT AUTO_INCREMENT PRIMARY KEY,
            personality_id INT NOT NULL,
            user_id INT NOT NULL,
            avatar_url MEDIUMTEXT NOT NULL,
            prompt TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL 24 HOUR),
            FOREIGN KEY (personality_id) REFERENCES personalities(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_personality_user (personality_id, user_id),
            INDEX idx_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Personality schedules table
        `CREATE TABLE IF NOT EXISTS personality_schedules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            personality_id INT NOT NULL,
            user_id INT NOT NULL,
            schedule JSON NOT NULL,
            summary TEXT,
            timezone VARCHAR(64),
            source VARCHAR(20) DEFAULT 'ai',
            version INT DEFAULT 1,
            generated_at TIMESTAMP NULL DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_personality (personality_id),
            INDEX idx_user_personality (user_id, personality_id),
            FOREIGN KEY (personality_id) REFERENCES personalities(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

        // Push subscriptions for web push notifications
        `CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            endpoint TEXT NOT NULL,
            endpoint_hash CHAR(64) NOT NULL,
            p256dh VARCHAR(255) NOT NULL,
            auth VARCHAR(255) NOT NULL,
            device VARCHAR(255),
            user_agent TEXT,
            active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_used_at TIMESTAMP NULL DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY unique_endpoint_hash (endpoint_hash),
            INDEX idx_user_active (user_id, active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    ];

    for (const tableQuery of tables) {
        await connection.execute(tableQuery);
    }
}

/**
 * User authentication methods
 */
const auth = {
    async register(username, email, password) {
        try {
            const passwordHash = await bcrypt.hash(password, 12);
            
            const [result] = await connection.execute(
                'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                [username, email, passwordHash]
            );
            
            const [user] = await connection.execute(
                'SELECT id, username, email, created_at FROM users WHERE id = ?',
                [result.insertId]
            );
            
            return user[0];
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                if (error.message.includes('email')) {
                    throw new Error('Email already exists');
                } else {
                    throw new Error('Username already exists');
                }
            }
            throw error;
        }
    },

    async login(email, password) {
        try {
            const [users] = await connection.execute(
                'SELECT id, username, email, password_hash FROM users WHERE email = ? AND is_active = TRUE',
                [email]
            );
            
            if (users.length === 0) {
                throw new Error('Invalid email or password');
            }
            
            const user = users[0];
            const passwordValid = await bcrypt.compare(password, user.password_hash);
            
            if (!passwordValid) {
                throw new Error('Invalid email or password');
            }
            
            // Update last login
            await connection.execute(
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [user.id]
            );
            
            return {
                id: user.id,
                username: user.username,
                email: user.email
            };
        } catch (error) {
            throw error;
        }
    },

    async getUserById(userId) {
        try {
            const [users] = await connection.execute(
                'SELECT id, username, email, created_at, last_login FROM users WHERE id = ? AND is_active = TRUE',
                [userId]
            );
            
            return users[0] || null;
        } catch (error) {
            throw error;
        }
    },

    async createSession(userId, tokenHash, expiresAt, ipAddress = null, userAgent = null) {
        try {
            // Clean up expired sessions first
            await connection.execute(
                'DELETE FROM user_sessions WHERE expires_at < NOW()'
            );

            // Create new session
            const [result] = await connection.execute(
                'INSERT INTO user_sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
                [userId, tokenHash, expiresAt, ipAddress, userAgent]
            );
            
            return result.insertId;
        } catch (error) {
            throw error;
        }
    },

    async validateSession(tokenHash) {
        try {
            const [sessions] = await connection.execute(
                'SELECT user_id, expires_at FROM user_sessions WHERE token_hash = ? AND expires_at > NOW()',
                [tokenHash]
            );
            
            return sessions[0] || null;
        } catch (error) {
            throw error;
        }
    },

    async deleteSession(tokenHash) {
        try {
            await connection.execute(
                'DELETE FROM user_sessions WHERE token_hash = ?',
                [tokenHash]
            );
        } catch (error) {
            throw error;
        }
    },

    async deleteUserSessions(userId) {
        try {
            await connection.execute(
                'DELETE FROM user_sessions WHERE user_id = ?',
                [userId]
            );
        } catch (error) {
            throw error;
        }
    },

    async cleanExpiredSessions() {
        try {
            await connection.execute(
                'DELETE FROM user_sessions WHERE expires_at < NOW()'
            );
        } catch (error) {
            throw error;
        }
    }
};

/**
 * Chat management methods
 */
const chats = {
    async createChat(userId, title, personalityId = null) {
        try {
            const [result] = await connection.execute(
                'INSERT INTO chats (user_id, title, personality_id, last_read_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
                [userId, title, personalityId]
            );
            
            return result.insertId;
        } catch (error) {
            throw error;
        }
    },

    async getUserChats(userId) {
        try {
            const [chats] = await connection.execute(`
                SELECT c.id, c.title, c.personality_id, c.created_at, c.updated_at, c.last_read_at,
                       p.name as personality_name,
                       COUNT(m.id) as message_count,
                       (SELECT content FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as lastMessage,
                       (SELECT role FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as lastMessageRole,
                       (SELECT created_at FROM messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as lastMessageTime
                FROM chats c
                LEFT JOIN personalities p ON c.personality_id = p.id
                LEFT JOIN messages m ON c.id = m.chat_id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY c.updated_at DESC
            `, [userId]);
            
            return chats.map(chat => ({
                ...chat,
                lastMessageTime: toIsoTimestamp(chat.lastMessageTime),
                lastReadAt: toIsoTimestamp(chat.last_read_at)
            }));
        } catch (error) {
            throw error;
        }
    },

    async getChatById(chatId, userId) {
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM chats WHERE id = ? AND user_id = ? LIMIT 1',
                [chatId, userId]
            );
            if (rows.length === 0) {
                return null;
            }
            const chat = rows[0];
            return {
                ...chat,
                created_at: toIsoTimestamp(chat.created_at),
                updated_at: toIsoTimestamp(chat.updated_at),
                last_read_at: toIsoTimestamp(chat.last_read_at)
            };
        } catch (error) {
            throw error;
        }
    },

    async getChatMessages(chatId, userId) {
        try {
            // Verify user owns this chat
            const [chats] = await connection.execute(
                'SELECT id FROM chats WHERE id = ? AND user_id = ?',
                [chatId, userId]
            );
            
            if (chats.length === 0) {
                throw new Error('Chat not found');
            }
            
            const [messages] = await connection.execute(
                'SELECT id, role, content, metadata, created_at FROM messages WHERE chat_id = ? ORDER BY created_at ASC',
                [chatId]
            );
            
            return messages.map(message => ({
                ...message,
                created_at: toIsoTimestamp(message.created_at)
            }));
        } catch (error) {
            throw error;
        }
    },

    async addMessage(chatId, role, content, metadata = null) {
        try {
            // Safely stringify metadata, handling circular references and large objects
            let metadataStr = null;
            if (metadata !== null) {
                try {
                    metadataStr = JSON.stringify(metadata);
                    // Limit metadata size to prevent database issues
                    if (metadataStr.length > 65535) {
                        console.warn('Metadata too large, truncating...');
                        metadataStr = JSON.stringify({ type: metadata.type, truncated: true });
                    }
                } catch (stringifyError) {
                    console.error('Error stringifying metadata:', stringifyError);
                    metadataStr = JSON.stringify({ error: 'Failed to serialize metadata' });
                }
            }
            
            const [result] = await connection.execute(
                'INSERT INTO messages (chat_id, role, content, metadata) VALUES (?, ?, ?, ?)',
                [chatId, role, content, metadataStr]
            );
            
            // Update chat timestamp
            await connection.execute(
                'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [chatId]
            );
            
            return result.insertId;
        } catch (error) {
            console.error('Database addMessage error:', error.message);
            throw error;
        }
    },

    async markChatAsRead(chatId, userId, readAt = new Date()) {
        try {
            const timestamp = new Date(readAt);
            await connection.execute(
                'UPDATE chats SET last_read_at = ? WHERE id = ? AND user_id = ?',
                [timestamp, chatId, userId]
            );
            return true;
        } catch (error) {
            throw error;
        }
    }
};

/**
 * Personality management methods
 */
const personalities = {
    async getUserPersonalities(userId) {
        try {
            const [personalities] = await connection.execute(
                'SELECT * FROM personalities WHERE user_id = ? ORDER BY created_at ASC',
                [userId]
            );
            
            return personalities;
        } catch (error) {
            throw error;
        }
    },

    async getPersonalityById(personalityId, userId) {
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM personalities WHERE id = ? AND user_id = ? LIMIT 1',
                [personalityId, userId]
            );
            return rows[0] || null;
        } catch (error) {
            throw error;
        }
    },

    async createPersonality(userId, personalityData) {
        try {
            const { name, display_name, description, system_prompt, avatar_url, temperature, max_tokens,
                   gender, age, build, hair_type, hair_color, eye_color, breast_size, height, ethnicity, 
                   personality_traits, speaking_style } = personalityData;
            
            const [result] = await connection.execute(`
                INSERT INTO personalities 
                (user_id, name, display_name, description, system_prompt, avatar_url, temperature, max_tokens,
                 gender, age, build, hair_type, hair_color, eye_color, breast_size, height, ethnicity,
                 personality_traits, speaking_style) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [userId, name, display_name, description, system_prompt, avatar_url, temperature, max_tokens,
                gender, age, build, hair_type, hair_color, eye_color, breast_size, height, ethnicity,
                personality_traits, speaking_style]);
            
            return result.insertId;
        } catch (error) {
            throw error;
        }
    },

    async updatePersonality(personalityId, userId, personalityData) {
        try {
            // Build dynamic UPDATE query based on provided fields
            const allowedFields = [
                'name', 'display_name', 'description', 'system_prompt', 'avatar_url', 
                'temperature', 'max_tokens', 'gender', 'age', 'build', 'hair_type', 
                'hair_color', 'eye_color', 'breast_size', 'height', 'ethnicity', 
                'personality_traits', 'speaking_style'
            ];
            
            const updates = [];
            const values = [];
            
            // Only include fields that are actually provided
            for (const field of allowedFields) {
                if (personalityData.hasOwnProperty(field)) {
                    updates.push(`${field} = ?`);
                    values.push(personalityData[field]);
                }
            }
            
            if (updates.length === 0) {
                throw new Error('No fields to update');
            }
            
            // Add updated_at timestamp
            updates.push('updated_at = CURRENT_TIMESTAMP');
            
            // Add WHERE clause parameters
            values.push(personalityId, userId);
            
            const sql = `
                UPDATE personalities 
                SET ${updates.join(', ')}
                WHERE id = ? AND user_id = ?
            `;
            
            const [result] = await connection.execute(sql, values);
            
            if (result.affectedRows === 0) {
                throw new Error('Personality not found or does not belong to user');
            }
            
            return true;
        } catch (error) {
            throw error;
        }
    },

    async deletePersonality(personalityId, userId) {
        try {
            const [result] = await connection.execute(
                'DELETE FROM personalities WHERE id = ? AND user_id = ?',
                [personalityId, userId]
            );
            
            if (result.affectedRows === 0) {
                throw new Error('Personality not found or does not belong to user');
            }
            
            return true;
        } catch (error) {
            throw error;
        }
    },

    async deleteChatMessages(chatId, userId) {
        try {
            // Verify chat belongs to user
            const [chatCheck] = await connection.execute(
                'SELECT id FROM chats WHERE id = ? AND user_id = ?',
                [chatId, userId]
            );
            
            if (chatCheck.length === 0) {
                throw new Error('Chat not found or does not belong to user');
            }
            
            // Delete all messages for this chat
            await connection.execute(
                'DELETE FROM messages WHERE chat_id = ?',
                [chatId]
            );
            
            return true;
        } catch (error) {
            throw error;
        }
    },

    async deleteAllUserChats(userId) {
        try {
            // Delete all chats and their messages (cascading delete handles messages)
            await connection.execute(
                'DELETE FROM chats WHERE user_id = ?',
                [userId]
            );
            
            return true;
        } catch (error) {
            throw error;
        }
    },

    async getPersonalitySchedule(personalityId, userId) {
        try {
            const [rows] = await connection.execute(
                'SELECT * FROM personality_schedules WHERE personality_id = ? AND user_id = ? LIMIT 1',
                [personalityId, userId]
            );
            if (rows.length === 0) {
                return null;
            }

            let scheduleData = rows[0].schedule;
            if (typeof scheduleData === 'string') {
                try {
                    scheduleData = JSON.parse(scheduleData);
                } catch (error) {
                    console.warn('Failed to parse schedule JSON, returning raw string');
                }
            }

            return {
                id: rows[0].id,
                personalityId: rows[0].personality_id,
                userId: rows[0].user_id,
                summary: rows[0].summary,
                timezone: rows[0].timezone,
                source: rows[0].source,
                version: rows[0].version,
                generatedAt: toIsoTimestamp(rows[0].generated_at),
                createdAt: toIsoTimestamp(rows[0].created_at),
                updatedAt: toIsoTimestamp(rows[0].updated_at),
                schedule: scheduleData
            };
        } catch (error) {
            throw error;
        }
    },

    async upsertPersonalitySchedule(personalityId, userId, schedulePayload = {}) {
        try {
            const payload = schedulePayload || {};
            const scheduleData = payload.schedule ?? payload;
            const scheduleJson = typeof scheduleData === 'string' ? scheduleData : JSON.stringify(scheduleData || {});
            const summary = payload.summary ?? scheduleData?.summary ?? null;
            const timezone = payload.timezone ?? scheduleData?.timezone ?? null;
            const source = payload.source ?? scheduleData?.source ?? 'user';
            const version = payload.version ?? scheduleData?.version ?? 1;
            const generatedAtValue = payload.generatedAt ?? scheduleData?.generatedAt ?? new Date().toISOString();
            const generatedAt = new Date(generatedAtValue);
            const safeGeneratedAt = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt;

            await connection.execute(`
                INSERT INTO personality_schedules (personality_id, user_id, schedule, summary, timezone, source, version, generated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    schedule = VALUES(schedule),
                    summary = VALUES(summary),
                    timezone = VALUES(timezone),
                    source = VALUES(source),
                    version = VALUES(version),
                    generated_at = VALUES(generated_at),
                    updated_at = CURRENT_TIMESTAMP
            `, [personalityId, userId, scheduleJson, summary, timezone, source, version, safeGeneratedAt]);

            return this.getPersonalitySchedule(personalityId, userId);
        } catch (error) {
            throw error;
        }
    },

    async deletePersonalitySchedule(personalityId, userId) {
        try {
            await connection.execute(
                'DELETE FROM personality_schedules WHERE personality_id = ? AND user_id = ?',
                [personalityId, userId]
            );
            return true;
        } catch (error) {
            throw error;
        }
    }
};

/**
 * Settings management methods
 */
const settings = {
    async getUserSettings(userId) {
        try {
            const [settings] = await connection.execute(
                'SELECT setting_key, setting_value FROM user_settings WHERE user_id = ?',
                [userId]
            );
            
            const settingsObj = {};
            settings.forEach(setting => {
                settingsObj[setting.setting_key] = setting.setting_value;
            });
            
            return settingsObj;
        } catch (error) {
            throw error;
        }
    },

    async updateUserSetting(userId, key, value) {
        try {
            await connection.execute(`
                INSERT INTO user_settings (user_id, setting_key, setting_value)
                VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = CURRENT_TIMESTAMP
            `, [userId, key, JSON.stringify(value)]);
        } catch (error) {
            throw error;
        }
    }
};

const pushSubscriptions = {
    hashEndpoint(endpoint) {
        return crypto.createHash('sha256').update(endpoint).digest('hex');
    },

    async saveSubscription(userId, subscription, metadata = {}) {
        if (!subscription || !subscription.endpoint || !subscription.keys) {
            throw new Error('Invalid subscription payload');
        }

        const endpointHash = this.hashEndpoint(subscription.endpoint);
        const p256dh = subscription.keys.p256dh;
        const authKey = subscription.keys.auth;

        if (!p256dh || !authKey) {
            throw new Error('Subscription keys missing');
        }

        const device = metadata.device || null;
        const userAgent = metadata.userAgent || null;

        await connection.execute(`
            INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, device, user_agent, active, last_used_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, NOW())
            ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                endpoint = VALUES(endpoint),
                p256dh = VALUES(p256dh),
                auth = VALUES(auth),
                device = VALUES(device),
                user_agent = VALUES(user_agent),
                active = TRUE,
                last_used_at = NOW(),
                updated_at = CURRENT_TIMESTAMP
        `, [userId, subscription.endpoint, endpointHash, p256dh, authKey, device, userAgent]);
    },

    async removeSubscription(userId, endpoint) {
        if (!endpoint) {
            return false;
        }
        const endpointHash = this.hashEndpoint(endpoint);
        const [result] = await connection.execute(`
            UPDATE push_subscriptions
            SET active = FALSE
            WHERE user_id = ? AND endpoint_hash = ?
        `, [userId, endpointHash]);
        return result.affectedRows > 0;
    },

    async deactivateSubscriptionById(id) {
        await connection.execute(
            'UPDATE push_subscriptions SET active = FALSE WHERE id = ?',
            [id]
        );
    },

    async markSubscriptionUsed(id) {
        await connection.execute(
            'UPDATE push_subscriptions SET last_used_at = NOW() WHERE id = ?',
            [id]
        );
    },

    async getActiveSubscriptions(userId) {
        const [rows] = await connection.execute(
            'SELECT * FROM push_subscriptions WHERE user_id = ? AND active = TRUE',
            [userId]
        );
        return rows;
    }
};

const pendingAvatars = {
    async savePendingAvatar(personalityId, userId, avatarUrl, prompt) {
        try {
            // Delete any existing pending avatar for this personality
            await connection.execute(`
                DELETE FROM pending_avatars 
                WHERE personality_id = ? AND user_id = ?
            `, [personalityId, userId]);
            
            // Insert new pending avatar
            const [result] = await connection.execute(`
                INSERT INTO pending_avatars (personality_id, user_id, avatar_url, prompt)
                VALUES (?, ?, ?, ?)
            `, [personalityId, userId, avatarUrl, prompt]);
            
            return result.insertId;
        } catch (error) {
            throw error;
        }
    },

    async getPendingAvatar(personalityId, userId) {
        try {
            const [rows] = await connection.execute(`
                SELECT * FROM pending_avatars 
                WHERE personality_id = ? AND user_id = ? 
                AND expires_at > NOW()
                ORDER BY created_at DESC
                LIMIT 1
            `, [personalityId, userId]);
            
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            throw error;
        }
    },

    async approvePendingAvatar(personalityId, userId) {
        try {
            // Get the pending avatar
            const pending = await this.getPendingAvatar(personalityId, userId);
            if (!pending) {
                throw new Error('No pending avatar found');
            }
            
            // Update personality with the avatar
            await personalities.updatePersonality(personalityId, userId, {
                avatar_url: pending.avatar_url
            });
            
            // Delete the pending avatar
            await connection.execute(`
                DELETE FROM pending_avatars 
                WHERE personality_id = ? AND user_id = ?
            `, [personalityId, userId]);
            
            return true;
        } catch (error) {
            throw error;
        }
    },

    async rejectPendingAvatar(personalityId, userId) {
        try {
            await connection.execute(`
                DELETE FROM pending_avatars 
                WHERE personality_id = ? AND user_id = ?
            `, [personalityId, userId]);
            
            return true;
        } catch (error) {
            throw error;
        }
    },

    async cleanupExpiredAvatars() {
        try {
            const [result] = await connection.execute(`
                DELETE FROM pending_avatars 
                WHERE expires_at <= NOW()
            `);
            
            return result.affectedRows;
        } catch (error) {
            throw error;
        }
    }
};

/**
 * Close database connection
 */
async function closeDatabase() {
    if (connection) {
        await connection.end();
        console.log('🔌 Database connection closed');
    }
}

module.exports = {
    initializeDatabase,
    closeDatabase,
    auth,
    chats,
    personalities,
    settings,
    pushSubscriptions,
    pendingAvatars,
    getConnection: () => connection
};