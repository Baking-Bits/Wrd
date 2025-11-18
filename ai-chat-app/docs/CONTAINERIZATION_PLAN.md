# AI Chat App - Containerization & User Account Plan

## 🎯 Goals
- Containerize the application for server deployment
- Add multi-user support with authentication
- Replace localStorage with server-side database storage
- Maintain all existing functionality while adding user isolation

## 🏗️ Architecture Overview

### Current State
```
[Browser] ←→ [Python Server] ←→ [AI Services (Docker)]
     ↓
[localStorage]
```

### Target State
```
[Browser] ←→ [Web App Container] ←→ [Database Container]
                    ↓
              [AI Services Containers]
```

## 👥 User Account System Design

### Authentication Flow
1. **Registration**: Email + Password → JWT Token
2. **Login**: Credentials → JWT Token (expires in 24h)
3. **Session**: JWT stored in httpOnly cookie
4. **Logout**: Clear cookie + blacklist token

### User Data Isolation
- Each user gets isolated data containers
- User-specific personalities, chat history, and settings
- Avatar images stored per user with file size limits

### Security Features
- Password hashing (bcrypt)
- JWT token authentication
- Rate limiting on auth endpoints
- Input validation and sanitization
- CORS configuration for production

## 📊 Database Schema

### Users Table
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    storage_quota_mb INTEGER DEFAULT 100
);
```

### User Settings Table
```sql
CREATE TABLE user_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    localai_url VARCHAR(255) DEFAULT 'http://192.168.1.206:8082',
    a1111_url VARCHAR(255) DEFAULT 'http://192.168.1.206:7860',
    comfyui_url VARCHAR(255) DEFAULT 'http://192.168.1.206:8188',
    default_personality_id INTEGER,
    theme_preference VARCHAR(20) DEFAULT 'dark',
    auto_generate_avatars BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Personalities Table
```sql
CREATE TABLE personalities (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    system_prompt TEXT NOT NULL,
    avatar_data TEXT, -- Base64 encoded image
    avatar_prompt TEXT,
    personality_traits JSONB, -- Array of traits
    background_info JSONB, -- Background details
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);
```

### Chat Sessions Table
```sql
CREATE TABLE chat_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    personality_id INTEGER REFERENCES personalities(id) ON DELETE SET NULL,
    session_name VARCHAR(200),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Chat Messages Table
```sql
CREATE TABLE chat_messages (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
    message_type VARCHAR(20) CHECK (message_type IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    metadata JSONB, -- For storing additional info like image data, tokens, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Token Blacklist Table (for logout)
```sql
CREATE TABLE token_blacklist (
    id SERIAL PRIMARY KEY,
    jti VARCHAR(36) UNIQUE NOT NULL, -- JWT ID
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 🐳 Container Architecture

### Services Overview
1. **web-app**: Main application (Node.js/Express + Static files)
2. **database**: PostgreSQL for data persistence
3. **redis**: Session cache and rate limiting
4. **nginx**: Reverse proxy and static file serving
5. **localai**: AI text generation
6. **automatic1111**: Image generation
7. **comfyui**: Advanced image workflows

### Container Network
```yaml
networks:
  ai-chat-network:
    driver: bridge
  ai-services-network:
    driver: bridge
```

## 🔄 Migration Strategy

### Phase 1: Backend API Development
- Create Express.js server with JWT authentication
- Implement REST API endpoints
- Set up PostgreSQL database with schema
- Add data migration tools

### Phase 2: Frontend Integration
- Update JavaScript to use API calls instead of localStorage
- Add login/register UI components
- Implement client-side authentication flow
- Add error handling and loading states

### Phase 3: Containerization
- Create Docker containers for all services
- Set up docker-compose orchestration
- Configure environment variables and secrets
- Add health checks and logging

### Phase 4: Production Setup
- Add nginx reverse proxy
- Implement SSL/TLS certificates
- Set up backup and monitoring
- Add user management admin panel

## 📁 New File Structure
```
ai-chat-app/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js
│   │   │   ├── users.js
│   │   │   ├── personalities.js
│   │   │   ├── chats.js
│   │   │   └── settings.js
│   │   ├── models/
│   │   ├── middleware/
│   │   ├── config/
│   │   └── app.js
│   ├── package.json
│   └── Dockerfile
├── frontend/ (existing files moved here)
│   ├── js/
│   ├── css/
│   ├── index.html
│   └── ...
├── database/
│   ├── migrations/
│   ├── seeds/
│   └── schema.sql
├── docker/
│   ├── nginx/
│   ├── docker-compose.yml
│   └── .env.example
└── scripts/
    ├── migration.js
    └── setup.sh
```

## 🚀 Deployment Commands
```bash
# Development
docker-compose up -d

# Production
docker-compose -f docker-compose.prod.yml up -d

# Migration from localStorage
node scripts/migration.js
```

This plan maintains all your existing functionality while adding proper user management and containerization for server deployment.