-- AI Chat App Database Schema
-- PostgreSQL compatible schema for multi-user AI chat application

-- Users table for authentication and profile management
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    storage_quota_mb INTEGER DEFAULT 100,
    is_admin BOOLEAN DEFAULT false
);

-- User settings table for AI service configurations
CREATE TABLE user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    localai_url VARCHAR(255) DEFAULT 'http://localhost:8082',
    a1111_url VARCHAR(255) DEFAULT 'http://localhost:7860',
    comfyui_url VARCHAR(255) DEFAULT 'http://localhost:8188',
    default_personality_id INTEGER,
    theme_preference VARCHAR(20) DEFAULT 'dark',
    auto_generate_avatars BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);

-- Personalities table for AI character definitions
CREATE TABLE personalities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    avatar_data TEXT, -- Base64 encoded image (consider moving to file storage for large images)
    avatar_prompt TEXT,
    personality_traits JSONB DEFAULT '[]'::jsonb, -- Array of trait strings
    background_info JSONB DEFAULT '{}'::jsonb, -- Object with background details
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_personality_name UNIQUE(user_id, name)
);

-- Chat sessions table for organizing conversations
CREATE TABLE chat_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    personality_id INTEGER REFERENCES personalities(id) ON DELETE SET NULL,
    session_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_read_at TIMESTAMP
);

-- Chat messages table for storing conversation history
CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_type VARCHAR(20) CHECK (message_type IN ('user', 'assistant', 'system')) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb, -- Additional data like image URLs, token counts, etc.
                                        -- Examples:
                                        -- Text: {"type": "text", "thinking": "...", "timestamp": 123456789}
                                        -- Image: {"type": "image", "prompt": "...", "timestamp": 123456789}
                                        -- Video: {"type": "video", "image_prompt": "...", "video_prompt": "...", "timestamp": 123456789}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token blacklist for logout functionality
CREATE TABLE token_blacklist (
    id SERIAL PRIMARY KEY,
    jti VARCHAR(36) UNIQUE NOT NULL, -- JWT ID
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance optimization
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_personalities_user_id ON personalities(user_id);
CREATE INDEX idx_personalities_default ON personalities(user_id, is_default);
CREATE INDEX idx_chat_sessions_user_id ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_personality ON chat_sessions(personality_id);
CREATE INDEX idx_chat_sessions_last_message ON chat_sessions(last_message_at DESC);
CREATE INDEX idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created_at ON chat_messages(created_at);
CREATE INDEX idx_token_blacklist_jti ON token_blacklist(jti);
CREATE INDEX idx_token_blacklist_expires ON token_blacklist(expires_at);

-- Function to update timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for automatic timestamp updates
CREATE TRIGGER update_user_settings_updated_at 
    BEFORE UPDATE ON user_settings 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_personalities_updated_at 
    BEFORE UPDATE ON personalities 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to update chat session's last_message_at when messages are added
CREATE OR REPLACE FUNCTION update_session_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE chat_sessions 
    SET last_message_at = NEW.created_at 
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to update session timestamp when messages are added
CREATE TRIGGER update_session_on_new_message
    AFTER INSERT ON chat_messages
    FOR EACH ROW EXECUTE FUNCTION update_session_last_message();

-- Clean up expired tokens (should be run periodically)
CREATE OR REPLACE FUNCTION clean_expired_tokens()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM token_blacklist WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ language 'plpgsql';

-- Insert default admin user (password: 'admin123' - CHANGE IN PRODUCTION!)
-- Password hash is for 'admin123' using bcrypt with salt rounds 12
INSERT INTO users (email, password_hash, display_name, is_active) VALUES 
('admin@localhost', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/r8Wv4Qu3y', 'Administrator', true);

-- Insert default settings for admin user
INSERT INTO user_settings (user_id) VALUES (1);

-- Insert default personality for admin user
INSERT INTO personalities (
    user_id, 
    name, 
    description,
    system_prompt,
    is_default
) VALUES (
    1,
    'Default Assistant',
    'A helpful AI assistant ready to chat',
    'You are a helpful AI assistant. Be friendly, informative, and engaging in your responses.',
    true
);

-- Update default personality reference in settings
UPDATE user_settings SET default_personality_id = 1 WHERE user_id = 1;

-- Pending avatars table for holding generated avatars before user approval
CREATE TABLE IF NOT EXISTS pending_avatars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    personality_id INT NOT NULL,
    user_id INT NOT NULL,
    avatar_url TEXT NOT NULL,
    prompt TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL 24 HOUR),
    FOREIGN KEY (personality_id) REFERENCES personalities(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_personality_user (personality_id, user_id),
    INDEX idx_expires (expires_at)
);