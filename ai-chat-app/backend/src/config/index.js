require('dotenv').config();

const config = {
  // Server configuration
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'ai_chat',
    user: process.env.DB_USER || 'aichat_user',
    password: process.env.DB_PASSWORD || 'password',
    ssl: process.env.NODE_ENV === 'production',
    pool: {
      min: 2,
      max: 10,
      acquireTimeoutMillis: 30000,
      idleTimeoutMillis: 30000
    }
  },

  // Redis configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || '',
    db: parseInt(process.env.REDIS_DB) || 0
  },

  // JWT configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },

  // File upload configuration
  upload: {
    maxFileSize: process.env.MAX_FILE_SIZE || '10MB',
    maxAvatarSize: process.env.MAX_AVATAR_SIZE || '2MB',
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ],
    uploadDir: process.env.UPLOAD_DIR || './uploads'
  },

  // Rate limiting configuration
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) * 60 * 1000 || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    authWindowMs: 15 * 60 * 1000, // 15 minutes for auth endpoints
    authMax: 5 // 5 attempts per 15 minutes for auth
  },

  // AI service URLs
  aiServices: {
    localai: {
      url: process.env.LOCALAI_URL || 'http://localhost:8082',
      timeout: 300000 // 5 minutes
    },
    automatic1111: {
      url: process.env.A1111_URL || 'http://localhost:7860',
      timeout: 300000 // 5 minutes
    },
    comfyui: {
      url: process.env.COMFYUI_URL || 'http://localhost:8188',
      timeout: 300000 // 5 minutes
    }
  },

  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000', 'http://localhost:8001'],
    credentials: true,
    optionsSuccessStatus: 200
  },

  // Email configuration (for user registration/password reset)
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || ''
    },
    from: process.env.SMTP_FROM || 'AI Chat <noreply@localhost>'
  },

  // Admin configuration
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@localhost',
    password: process.env.ADMIN_PASSWORD || 'admin123'
  },

  // Security configuration
  security: {
    bcryptRounds: 12,
    cookieSecret: process.env.COOKIE_SECRET || 'cookie-secret-change-in-production',
    sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000 // 15 minutes
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.NODE_ENV === 'development' ? 'dev' : 'combined'
  },

  // Application-specific settings
  app: {
    defaultPersonalityName: 'Default Assistant',
    maxPersonalitiesPerUser: 50,
    maxChatSessionsPerUser: 100,
    maxMessagesPerSession: 1000,
    defaultStorageQuotaMB: 100
  }
};

// Validation
if (!config.jwt.secret || config.jwt.secret === 'your-secret-key-change-in-production') {
  if (config.nodeEnv === 'production') {
    console.error('❌ JWT_SECRET must be set in production!');
    process.exit(1);
  } else {
    console.warn('⚠️  Using default JWT secret. Set JWT_SECRET for production!');
  }
}

if (!config.database.password || config.database.password === 'password') {
  if (config.nodeEnv === 'production') {
    console.error('❌ DB_PASSWORD must be set in production!');
    process.exit(1);
  }
}

module.exports = config;