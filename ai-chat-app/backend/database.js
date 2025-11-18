const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const config = require('./config');

// Database configuration from centralized config
const dbConfig = {
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    charset: 'utf8mb4',
    timezone: '+00:00'
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
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (personality_id) REFERENCES personalities(id) ON DELETE SET NULL,
            INDEX idx_user_id (user_id),
            INDEX idx_created_at (created_at)
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
                'INSERT INTO chats (user_id, title, personality_id) VALUES (?, ?, ?)',
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
                SELECT c.id, c.title, c.personality_id, c.created_at, c.updated_at, p.name as personality_name,
                       COUNT(m.id) as message_count
                FROM chats c
                LEFT JOIN personalities p ON c.personality_id = p.id
                LEFT JOIN messages m ON c.id = m.chat_id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY c.updated_at DESC
            `, [userId]);
            
            return chats;
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
            
            return messages;
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
            const { name, display_name, description, system_prompt, avatar_url, temperature, max_tokens,
                   gender, age, build, hair_type, hair_color, eye_color, breast_size, height, ethnicity,
                   personality_traits, speaking_style } = personalityData;
            
            const [result] = await connection.execute(`
                UPDATE personalities 
                SET name = ?, display_name = ?, description = ?, system_prompt = ?, 
                    avatar_url = ?, temperature = ?, max_tokens = ?,
                    gender = ?, age = ?, build = ?, hair_type = ?, hair_color = ?, eye_color = ?,
                    breast_size = ?, height = ?, ethnicity = ?, personality_traits = ?, speaking_style = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
            `, [name, display_name, description, system_prompt, avatar_url, temperature, max_tokens,
                gender, age, build, hair_type, hair_color, eye_color, breast_size, height, ethnicity,
                personality_traits, speaking_style, personalityId, userId]);
            
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
    getConnection: () => connection
};