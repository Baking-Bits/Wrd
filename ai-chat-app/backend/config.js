/**
 * Application Configuration
 * Centralized configuration for all AI services and application settings
 */

// Load environment variables
require('dotenv').config();

const config = {
    // Server Configuration
    server: {
        port: process.env.PORT || 3000,
        host: process.env.HOST || 'localhost'
    },

    // Database Configuration
    database: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'user',
        password: process.env.DB_PASSWORD || 'password',
        database: process.env.DB_NAME || 'database'
    },

    // AI Services Configuration
    ai: {
        // LocalAI Configuration
        localai: {
            url: process.env.LOCALAI_URL || 'http://localhost:8082',
            defaultModel: process.env.LOCALAI_MODEL || 'default-model',
            autoUnload: true, // Always enabled - unload after each response
            timeout: 300000 // 5 minutes
        },

        // Automatic1111 Configuration
        automatic1111: {
            url: process.env.AUTOMATIC1111_URL || 'http://localhost:7860',
            timeout: 300000 // 5 minutes
        },

        // ComfyUI Configuration
        comfyui: {
            url: process.env.COMFYUI_URL || 'http://localhost:8188',
            timeout: 300000 // 5 minutes
        }
    },

    // Docker Container Management
    docker: {
        // SSH Configuration for Remote Docker Management
        ssh: {
            host: process.env.DOCKER_SSH_HOST || 'localhost',
            port: process.env.DOCKER_SSH_PORT || 22,
            username: process.env.DOCKER_SSH_USER || 'root',
            password: process.env.DOCKER_SSH_PASS, // Set in environment
            privateKey: process.env.DOCKER_SSH_KEY, // Private key content
            privateKeyPath: process.env.DOCKER_SSH_KEY_PATH, // Path to private key file
            connectTimeout: 10000,
            readyTimeout: 10000
        },
        
        containers: {
            localai: {
                name: process.env.DOCKER_CONTAINER_LOCALAI || 'local-ai',
                displayName: 'LocalAI',
                description: 'Text generation and chat',
                autoManage: false, // Keep running
                healthCheck: '/v1/models'
            },
            a1111: {
                name: process.env.DOCKER_CONTAINER_A1111 || 'AUTOMATIC1111-Stable-Diffusion-Web-UI', 
                displayName: 'Automatic1111',
                description: 'Image generation',
                autoManage: true, // Start/stop automatically
                startupTime: 30000, // 30 seconds startup time
                healthCheck: '/sdapi/v1/samplers'
            },
            comfyui: {
                name: process.env.DOCKER_CONTAINER_COMFYUI || 'comfyui',
                displayName: 'ComfyUI', 
                description: 'Advanced workflows',
                autoManage: true, // Start/stop automatically
                startupTime: 20000, // 20 seconds startup time
                healthCheck: '/system_stats'
            }
        },
        
        // Docker Commands
        commands: {
            start: 'docker start {container}',
            stop: 'docker stop {container}',
            status: 'docker ps -a --filter name={container} --format "{{.Status}}"',
            logs: 'docker logs --tail 10 {container}'
        }
    },

    // Default AI Personalities
    defaultPersonalities: [
        {
            name: 'assistant',
            displayName: 'AI Assistant',
            description: 'General purpose helpful assistant',
            avatar: '🤖',
            systemPrompt: 'You are a helpful, knowledgeable, and friendly AI assistant. You provide accurate information and assistance while maintaining a conversational and supportive tone.',
            temperature: 0.7,
            maxTokens: 2000,
            isDefault: true
        },
        {
            name: 'creative',
            displayName: 'Creative Writer',
            description: 'Creative writing and storytelling',
            avatar: '✍️',
            systemPrompt: 'You are a creative writing assistant with a passion for storytelling, poetry, and imaginative content. You help with creative projects, brainstorming, and artistic expression.',
            temperature: 0.9,
            maxTokens: 2500,
            isDefault: false
        },
        {
            name: 'technical',
            displayName: 'Tech Expert',
            description: 'Technical assistance and programming',
            avatar: '💻',
            systemPrompt: 'You are a technical expert specializing in programming, software development, and technology. You provide accurate technical guidance, code examples, and problem-solving assistance.',
            temperature: 0.3,
            maxTokens: 3000,
            isDefault: false
        },
        {
            name: 'teacher',
            displayName: 'Tutor',
            description: 'Educational and learning support',
            avatar: '🎓',
            systemPrompt: 'You are an educational tutor who excels at explaining complex topics in simple terms. You use examples, analogies, and step-by-step explanations to help others learn.',
            temperature: 0.5,
            maxTokens: 2000,
            isDefault: false
        }
    ],

    // JWT Configuration
    jwt: {
        secret: process.env.JWT_SECRET || 'your-super-secret-key-change-this-in-production',
        expiresIn: '7d'
    }
};

module.exports = config;