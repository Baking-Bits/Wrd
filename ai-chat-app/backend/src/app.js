const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');

// Import configuration and database
const config = require('./config');
const { initializeDatabase, closeDatabase } = require('./database/postgres');
const { initializeRedis, closeRedis } = require('./database/redis');

// Import routes
const authRoutes = require('./routes/auth');
const personalitiesRoutes = require('./routes/personalities');
const chatsRoutes = require('./routes/chats');
const settingsRoutes = require('./routes/settings');
const aiRoutes = require('./routes/ai');

// Create Express app
const app = express();

// Trust proxy (important for rate limiting and CORS when behind nginx)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// CORS middleware
app.use(cors(config.cors));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser(config.security.cookieSecret));

// Logging middleware
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    error: 'Too many requests',
    message: 'You have made too many requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Serve static files from public directory (frontend)
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.nodeEnv
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/personalities', personalitiesRoutes);
app.use('/api/chats', chatsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ai', aiRoutes);

// Handle 404 for API routes (MUST come before catch-all)
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
    message: `The endpoint ${req.method} ${req.path} does not exist`
  });
});

// Global error handling middleware
app.use((error, req, res, next) => {
  console.error('Global error handler:', error);

  // Handle specific error types
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Request body contains invalid JSON'
    });
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Request too large',
      message: 'Request body exceeds size limit'
    });
  }

  // Default error response
  res.status(error.status || 500).json({
    error: error.message || 'Internal server error',
    message: config.nodeEnv === 'development' ? error.stack : 'An unexpected error occurred'
  });
});

// Serve frontend for all other routes (SPA support - MUST be last)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

/**
 * Initialize database connections
 */
const initializeConnections = async () => {
  try {
    console.log('🚀 Starting AI Chat Backend Server...');
    
    // Initialize PostgreSQL
    await initializeDatabase();
    console.log('✅ MariaDB connected');

    // Initialize cache storage (database-backed)
    await initializeRedis();
    console.log('✅ Cache storage initialized');

    return true;
  } catch (error) {
    console.error('❌ Failed to initialize connections:', error);
    return false;
  }
};

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = async (signal) => {
  console.log(`\n📡 Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Close database connections
    await closeDatabase();
    console.log('🔌 MariaDB connections closed');
    
    await closeRedis();
    console.log('🔌 Cache storage closed');
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

/**
 * Start the server
 */
const startServer = async () => {
  // Initialize connections first
  const connectionsReady = await initializeConnections();
  
  if (!connectionsReady) {
    console.error('❌ Failed to start server - database connections failed');
    process.exit(1);
  }

  // Start HTTP server
  const server = app.listen(config.port, () => {
    console.log('='.repeat(70));
    console.log('🤖 AI CHAT BACKEND SERVER STARTED 🤖');
    console.log('='.repeat(70));
    console.log();
    console.log('✅ Server Status:');
    console.log(`   🌐 Port: ${config.port}`);
    console.log(`   🔧 Environment: ${config.nodeEnv}`);
    console.log(`   🗄️  Database: MariaDB (${config.database.host}:${config.database.port})`);
    console.log(`   💾 Cache: MariaDB-backed (in-database)`);
    console.log();
    console.log('🔗 API Endpoints:');
    console.log(`   🔐 Authentication: /api/auth/*`);
    console.log(`   👤 Personalities: /api/personalities/*`);
    console.log(`   💬 Chat Sessions: /api/chats/*`);
    console.log(`   ⚙️  Settings: /api/settings/*`);
    console.log(`   🤖 AI Proxy: /api/ai/*`);
    console.log();
    console.log('🔧 AI Services:');
    console.log(`   💬 LocalAI: ${config.aiServices.localai.url}`);
    console.log(`   🎨 Automatic1111: ${config.aiServices.automatic1111.url}`);
    console.log(`   🔧 ComfyUI: ${config.aiServices.comfyui.url}`);
    console.log();
    console.log('🚀 READY FOR REQUESTS!');
    console.log('💻 Use Ctrl+C to stop the server');
    console.log('='.repeat(70));
  });

  // Increase server timeout for AI requests
  server.timeout = 300000; // 5 minutes

  return server;
};

// Start the server if this file is executed directly
if (require.main === module) {
  startServer().catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
}

module.exports = app;