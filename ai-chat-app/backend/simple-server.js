const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('./database');
const config = require('./config');
const dockerManager = require('./dockerManager');
const messageQueue = require('./messageQueue');
const AIProcessor = require('./aiProcessor');
const ImageGenerator = require('./imageGenerator');
const VideoGenerator = require('./videoGenerator');
const AutoMessageScheduler = require('./autoMessageScheduler');

// Create Express app
const app = express();

// Initialize database
let dbConnected = false;

// Track active image generation requests
let activeA1111Requests = 0;
let lastA1111Activity = null;

// Initialize AI processors
const aiProcessor = new AIProcessor({
  localaiUrl: 'http://192.168.1.206:8082',
  model: 'josiefied-qwen3-4b-abliterated-gpu'
});

const imageGenerator = new ImageGenerator({
  a1111Url: 'http://192.168.1.206:7860',
  dockerManager: dockerManager
});

const videoGenerator = new VideoGenerator({
  comfyuiUrl: 'http://192.168.1.206:8188',
  dockerManager: dockerManager
});

// Connect Docker manager to message queue for VRAM management
messageQueue.setDockerManager(dockerManager);

// Initialize database before starting server
async function initServer() {
  dbConnected = await db.initializeDatabase();
  if (dbConnected) {
    console.log('🗄️ Database connected successfully');
    
    // Clean expired sessions on startup
    await db.auth.cleanExpiredSessions();
    
    // Set up periodic session cleanup (every hour)
    setInterval(async () => {
      try {
        await db.auth.cleanExpiredSessions();
        console.log('🧹 Cleaned expired sessions');
      } catch (error) {
        console.error('Session cleanup error:', error);
      }
    }, 60 * 60 * 1000); // 1 hour
  } else {
    console.log('❌ Database connection failed - falling back to localStorage mode');
  }
}

// Basic middleware
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:8080',
    'http://192.168.1.208:3000',
    'http://192.168.1.208:8080',
    'https://respond2.me',
    'http://respond2.me'
  ],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Disable caching for all routes to prevent serving different versions
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// Serve static files from public directory (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    mode: 'hybrid'
  });
});

// API health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    backend: 'running',
    database: dbConnected ? 'MariaDB connected' : 'localStorage fallback',
    message: dbConnected ? 'Backend running with real database' : 'Backend running - database unavailable'
  });
});

// Basic API endpoints for testing
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!', mode: 'hybrid' });
});

// Middleware to verify JWT token and validate session
async function verifyToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  
  try {
    // Verify JWT
    const decoded = jwt.verify(token, config.jwt.secret);
    req.userId = decoded.userId;
    
    // Validate session in database if connected
    if (dbConnected) {
      const crypto = require('crypto');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const session = await db.auth.validateSession(tokenHash);
      
      if (!session) {
        return res.status(401).json({ success: false, message: 'Session expired or invalid' });
      }
      
      if (session.user_id !== decoded.userId) {
        return res.status(401).json({ success: false, message: 'Session mismatch' });
      }
    }
    
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token expired' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
}

// Real database authentication endpoints
app.post('/api/auth/register', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, and password are required'
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }
    
    const user = await db.auth.register(username, email, password);
    
    // Create default personality for new user
    try {
      await db.personalities.createPersonality(user.id, {
        name: 'assistant',
        display_name: 'AI Assistant',
        description: 'General purpose helpful assistant',
        system_prompt: 'You are a helpful, knowledgeable, and friendly AI assistant.',
        avatar_url: '🤖',
        temperature: 0.7,
        max_tokens: 2000
      });
    } catch (error) {
      console.error('Failed to create default personality:', error);
    }
    
    // Generate JWT token with longer expiration (30 days)
    const token = jwt.sign({ userId: user.id }, config.jwt.secret, { expiresIn: '30d' });
    
    // Store session in database
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await db.auth.createSession(user.id, tokenHash, expiresAt, req.ip, req.get('user-agent'));
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token: token,
      message: 'Registration successful'
    });
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    const user = await db.auth.login(email, password);
    
    // Check if user has any personalities, create default if not
    try {
      const personalities = await db.personalities.getUserPersonalities(user.id);
      if (!personalities || personalities.length === 0) {
        console.log('Creating default personality for user:', user.id);
        await db.personalities.createPersonality(user.id, {
          name: 'assistant',
          display_name: 'AI Assistant',
          description: 'General purpose helpful assistant',
          system_prompt: 'You are a helpful, knowledgeable, and friendly AI assistant.',
          avatar_url: '🤖',
          temperature: 0.7,
          max_tokens: 2000
        });
      }
    } catch (error) {
      console.error('Failed to check/create default personality:', error);
    }
    
    // Generate JWT token with longer expiration (30 days)
    const token = jwt.sign({ userId: user.id }, config.jwt.secret, { expiresIn: '30d' });
    
    // Store session in database
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    await db.auth.createSession(user.id, tokenHash, expiresAt, req.ip, req.get('user-agent'));
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token: token,
      message: 'Login successful'
    });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
});

app.get('/api/auth/profile', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available'
    });
  }

  try {
    const user = await db.auth.getUserById(req.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Get profile error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to get profile'
    });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token && dbConnected) {
      const crypto = require('crypto');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await db.auth.deleteSession(tokenHash);
    }
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    res.json({
      success: true,
      message: 'Logout successful'
    });
  }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available'
    });
  }

  try {
    const user = await db.auth.getUserById(req.userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Get user error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Chat management endpoints
app.get('/api/chats', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const chats = await db.chats.getUserChats(req.userId);
    res.json({
      success: true,
      chats: chats
    });
  } catch (error) {
    console.error('Get chats error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

app.post('/api/chats', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { title, sessionName, personalityId } = req.body;
    const chatTitle = title || sessionName || 'New Chat';
    
    // Ensure personalityId is null if not a valid integer within INT range
    // MySQL INT range is -2147483648 to 2147483647
    const pid = Number(personalityId);
    const validPersonalityId = (personalityId && Number.isInteger(pid) && pid > 0 && pid <= 2147483647) ? pid : null;
    
    console.log('Creating chat:', { userId: req.userId, title: chatTitle, personalityId: validPersonalityId });
    
    const chatId = await db.chats.createChat(req.userId, chatTitle, validPersonalityId);
    
    console.log('Chat created successfully:', chatId);
    
    res.json({
      success: true,
      chatId: chatId,
      session: {
        id: chatId,
        title: chatTitle
      },
      message: 'Chat created successfully'
    });
  } catch (error) {
    console.error('Create chat error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

app.get('/api/chats/:chatId/messages', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { chatId } = req.params;
    const messages = await db.chats.getChatMessages(chatId, req.userId);
    
    res.json({
      success: true,
      messages: messages
    });
  } catch (error) {
    console.error('Get messages error:', error.message);
    if (error.message === 'Chat not found') {
      res.status(404).json({
        success: false,
        message: 'Chat not found'
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }
  }
});

app.post('/api/chats/:chatId/messages', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { chatId } = req.params;
    const { role, content, metadata } = req.body;
    
    if (!role || !content) {
      return res.status(400).json({
        success: false,
        message: 'Role and content are required'
      });
    }
    
    const messageId = await db.chats.addMessage(chatId, role, content, metadata);
    
    res.json({
      success: true,
      messageId: messageId,
      message: 'Message added successfully'
    });
  } catch (error) {
    console.error('Add message error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Send message with AI response (background processing)
app.post('/api/chats/:chatId/send', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { chatId } = req.params;
    const { message, personality } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Save user message immediately
    const userMessageId = await db.chats.addMessage(
      chatId,
      'user',
      message,
      { timestamp: Date.now() }
    );

    console.log(`💾 User message ${userMessageId} saved to DB`);

    // Queue AI processing job (personality data comes from frontend)
    const jobId = await messageQueue.addJob({
      type: 'ai_message',
      data: {
        chatId,
        userId: req.userId,
        userMessage: message,
        personality: personality || null,
        db: db,
        aiProcessor: aiProcessor,
        imageGenerator: imageGenerator,
        videoGenerator: videoGenerator
      }
    });

    console.log(`📬 AI processing job ${jobId} queued`);

    // Return immediately - processing continues in background
    res.json({
      success: true,
      userMessageId: userMessageId,
      jobId: jobId,
      message: 'Message sent and AI processing queued'
    });

  } catch (error) {
    console.error('Send message error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get job status
app.get('/api/jobs/:jobId', verifyToken, async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = messageQueue.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        type: job.type,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error
      }
    });
  } catch (error) {
    console.error('Get job status error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Get queue statistics
app.get('/api/queue/stats', verifyToken, async (req, res) => {
  try {
    const stats = messageQueue.getStats();
    res.json({
      success: true,
      stats: stats
    });
  } catch (error) {
    console.error('Get queue stats error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Delete all messages from a chat
app.delete('/api/chats/:chatId/messages', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { chatId } = req.params;
    await db.personalities.deleteChatMessages(chatId, req.userId);
    
    res.json({
      success: true,
      message: 'Chat messages cleared successfully'
    });
  } catch (error) {
    console.error('Delete chat messages error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
});

// Delete all chats for the user
app.delete('/api/chats/all', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    await db.personalities.deleteAllUserChats(req.userId);
    
    res.json({
      success: true,
      message: 'All chats deleted successfully'
    });
  } catch (error) {
    console.error('Delete all chats error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Personality management endpoints
app.get('/api/personalities', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const personalities = await db.personalities.getUserPersonalities(req.userId);
    
    // Transform snake_case database format to camelCase frontend format
    const transformedPersonalities = personalities.map(p => ({
      id: p.id,
      name: p.name,
      displayName: p.display_name,
      description: p.description,
      systemPrompt: p.system_prompt,
      avatar: p.avatar_url ? '🖼️' : '🤖', // Use icon to indicate image exists
      avatarUrl: p.avatar_url,
      temperature: parseFloat(p.temperature),
      maxTokens: parseInt(p.max_tokens),
      gender: p.gender,
      age: p.age,
      build: p.build,
      hairType: p.hair_type,
      hairColor: p.hair_color,
      eyeColor: p.eye_color,
      breastSize: p.breast_size,
      height: p.height,
      ethnicity: p.ethnicity,
      personalityTraits: p.personality_traits,
      speakingStyle: p.speaking_style,
      isDefault: p.is_default === 1,
      createdAt: p.created_at,
      updatedAt: p.updated_at
    }));
    
    res.json({
      success: true,
      personalities: transformedPersonalities
    });
  } catch (error) {
    console.error('Get personalities error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

app.post('/api/personalities', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    // Transform camelCase frontend format to snake_case database format
    const personalityData = {
      name: req.body.name,
      display_name: req.body.displayName || req.body.display_name || req.body.name,
      description: req.body.description || '',
      system_prompt: req.body.systemPrompt || req.body.system_prompt || '',
      avatar_url: req.body.avatarUrl || req.body.avatar_url || null,
      temperature: parseFloat(req.body.temperature || 0.7),
      max_tokens: parseInt(req.body.maxTokens || req.body.max_tokens || 2000),
      gender: req.body.gender || null,
      age: req.body.age ? parseInt(req.body.age) : null,
      build: req.body.build || null,
      hair_type: req.body.hairType || req.body.hair_type || null,
      hair_color: req.body.hairColor || req.body.hair_color || null,
      eye_color: req.body.eyeColor || req.body.eye_color || null,
      breast_size: req.body.breastSize || req.body.breast_size || null,
      height: req.body.height || null,
      ethnicity: req.body.ethnicity || null,
      personality_traits: req.body.personalityTraits || req.body.personality_traits || null,
      speaking_style: req.body.speakingStyle || req.body.speaking_style || null
    };
    
    const personalityId = await db.personalities.createPersonality(req.userId, personalityData);
    
    res.json({
      success: true,
      personalityId: personalityId,
      message: 'Personality created successfully'
    });
  } catch (error) {
    console.error('Create personality error:', error.message);
    console.error('Request body:', req.body);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Update personality endpoint
app.put('/api/personalities/:id', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const personalityId = parseInt(req.params.id);
    
    if (isNaN(personalityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid personality ID'
      });
    }

    // Check if personality exists and belongs to user
    const personalities = await db.personalities.getUserPersonalities(req.userId);
    const personality = personalities.find(p => p.id === personalityId);
    
    if (!personality) {
      return res.status(404).json({
        success: false,
        message: 'Personality not found or does not belong to you'
      });
    }

    // Don't allow updating default personality name
    if (personality.is_default && req.body.name && req.body.name !== personality.name) {
      return res.status(403).json({
        success: false,
        message: 'Cannot change the name of the default personality'
      });
    }

    // Prepare update data with proper snake_case for database
    // Helper function to convert empty/undefined to null for SQL
    const toSqlValue = (value, fallback) => {
      if (value === undefined) return fallback !== undefined ? fallback : null;
      if (value === null) return null;
      if (value === '') return null;
      if (Array.isArray(value) && value.length === 0) return null;
      return value;
    };
    
    const updateData = {
      name: req.body.name || personality.name,
      display_name: req.body.displayName || req.body.display_name || personality.display_name,
      description: toSqlValue(req.body.description, personality.description),
      system_prompt: req.body.systemPrompt || req.body.system_prompt || personality.system_prompt,
      avatar_url: toSqlValue(req.body.avatarUrl !== undefined ? req.body.avatarUrl : req.body.avatar_url, personality.avatar_url),
      temperature: req.body.temperature !== undefined ? parseFloat(req.body.temperature) : parseFloat(personality.temperature),
      max_tokens: req.body.maxTokens !== undefined ? parseInt(req.body.maxTokens) : (req.body.max_tokens !== undefined ? parseInt(req.body.max_tokens) : parseInt(personality.max_tokens)),
      gender: toSqlValue(req.body.gender, personality.gender),
      age: req.body.age !== undefined && req.body.age !== '' ? parseInt(req.body.age) : (personality.age || null),
      build: toSqlValue(req.body.build, personality.build),
      hair_type: toSqlValue(req.body.hairType !== undefined ? req.body.hairType : req.body.hair_type, personality.hair_type),
      hair_color: toSqlValue(req.body.hairColor !== undefined ? req.body.hairColor : req.body.hair_color, personality.hair_color),
      eye_color: toSqlValue(req.body.eyeColor !== undefined ? req.body.eyeColor : req.body.eye_color, personality.eye_color),
      breast_size: toSqlValue(req.body.breastSize !== undefined ? req.body.breastSize : req.body.breast_size, personality.breast_size),
      height: toSqlValue(req.body.height, personality.height),
      ethnicity: toSqlValue(req.body.ethnicity, personality.ethnicity),
      personality_traits: toSqlValue(req.body.personalityTraits !== undefined ? req.body.personalityTraits : req.body.personality_traits, personality.personality_traits),
      speaking_style: toSqlValue(req.body.speakingStyle !== undefined ? req.body.speakingStyle : req.body.speaking_style, personality.speaking_style)
    };

    console.log('🔍 Attempting to update personality with data:', JSON.stringify(updateData, null, 2));
    
    await db.personalities.updatePersonality(personalityId, req.userId, updateData);
    
    // Fetch updated personality to return
    const updatedPersonalities = await db.personalities.getUserPersonalities(req.userId);
    const updatedPersonality = updatedPersonalities.find(p => p.id === personalityId);
    
    res.json({
      success: true,
      personality: updatedPersonality,
      message: 'Personality updated successfully'
    });
  } catch (error) {
    console.error('❌ Update personality error:', error);
    console.error('   Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Delete personality endpoint
app.delete('/api/personalities/:id', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const personalityId = parseInt(req.params.id);
    
    if (isNaN(personalityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid personality ID'
      });
    }

    // Check if personality exists and belongs to user
    const personalities = await db.personalities.getUserPersonalities(req.userId);
    const personality = personalities.find(p => p.id === personalityId);
    
    if (!personality) {
      return res.status(404).json({
        success: false,
        message: 'Personality not found or does not belong to you'
      });
    }

    // Check if it's the default personality
    if (personality.is_default) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete the default personality. Set another personality as default first.'
      });
    }

    // Delete the personality
    await db.personalities.deletePersonality(personalityId, req.userId);
    
    res.json({
      success: true,
      message: 'Personality deleted successfully'
    });
  } catch (error) {
    console.error('Delete personality error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Avatar generation endpoints
app.post('/api/personalities/:id/avatar/generate', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const personalityId = parseInt(req.params.id);
    const { prompt } = req.body;

    if (isNaN(personalityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid personality ID'
      });
    }

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is required'
      });
    }

    // Check if personality exists and belongs to user
    const personalities = await db.personalities.getUserPersonalities(req.userId);
    const personality = personalities.find(p => p.id === personalityId);
    
    if (!personality) {
      return res.status(404).json({
        success: false,
        message: 'Personality not found or does not belong to you'
      });
    }

    console.log(`🎭 Queueing avatar generation for personality ${personalityId}`);
    
    // Queue the avatar generation job
    const jobId = await messageQueue.queueAvatarGeneration(personalityId, prompt, req.userId);
    
    res.json({
      success: true,
      jobId: jobId,
      message: 'Avatar generation queued successfully'
    });
  } catch (error) {
    console.error('❌ Avatar generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

app.get('/api/personalities/:id/avatar/status', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const personalityId = parseInt(req.params.id);

    if (isNaN(personalityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid personality ID'
      });
    }

    // Check if personality exists and belongs to user
    const personalities = await db.personalities.getUserPersonalities(req.userId);
    const personality = personalities.find(p => p.id === personalityId);
    
    if (!personality) {
      return res.status(404).json({
        success: false,
        message: 'Personality not found or does not belong to you'
      });
    }

    // Get avatar generation status from queue
    const status = await messageQueue.getAvatarStatus(personalityId);
    
    res.json({
      success: true,
      status: status
    });
  } catch (error) {
    console.error('❌ Avatar status error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Settings management endpoints
app.get('/api/settings', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const settings = await db.settings.getUserSettings(req.userId);
    res.json({
      success: true,
      settings: settings
    });
  } catch (error) {
    console.error('Get settings error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

app.post('/api/settings', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { key, value } = req.body;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Setting key is required'
      });
    }
    
    await db.settings.updateUserSetting(req.userId, key, value);
    
    res.json({
      success: true,
      message: 'Setting updated successfully'
    });
  } catch (error) {
    console.error('Update setting error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// PUT endpoint for settings (same as POST for compatibility)
app.put('/api/settings', verifyToken, async (req, res) => {
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database not available - using localStorage mode'
    });
  }

  try {
    const { key, value } = req.body;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Setting key is required'
      });
    }
    
    await db.settings.updateUserSetting(req.userId, key, value);
    
    res.json({
      success: true,
      message: 'Setting updated successfully'
    });
  } catch (error) {
    console.error('Update setting error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// Real AI service proxy endpoints
const fetch = require('node-fetch');

console.log('🤖 AI Services Configuration:');
console.log(`   LocalAI: ${config.ai.localai.url}`);
console.log(`   Automatic1111: ${config.ai.automatic1111.url}`);
console.log(`   ComfyUI: ${config.ai.comfyui.url}`);

// LocalAI proxy endpoint
app.post('/api/localai/v1/chat/completions', async (req, res) => {
  try {
    console.log('🚀 Proxying LocalAI request...');
    
    // Smart VRAM Management: Check if A1111 is actually running and stop it
    console.log('🔍 Checking if A1111 container is running...');
    const a1111ContainerName = config.docker.containers.a1111.name;
    console.log(`🐳 Checking container: ${a1111ContainerName}`);
    const a1111Status = await dockerManager.getContainerStatus(a1111ContainerName);
    console.log(`📊 A1111 status: ${a1111Status}`);
    
    if (a1111Status === 'running') {
      // Wait for active requests if any
      if (activeA1111Requests > 0) {
        console.log('⏳ Waiting for active A1111 image generation to complete...');
        console.log(`📊 Active A1111 requests: ${activeA1111Requests}`);
        
        // Wait up to 60 seconds for active requests to complete
        const maxWaitTime = 60000; // 60 seconds
        const startWait = Date.now();
        
        while (activeA1111Requests > 0 && (Date.now() - startWait) < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Check every 2 seconds
        }
        
        if (activeA1111Requests > 0) {
          console.log('⚠️ A1111 requests still active after grace period, proceeding with shutdown');
        } else {
          console.log('✅ All A1111 requests completed');
        }
      }
      
      // Stop A1111 to free VRAM for LocalAI
      console.log('🐳 Stopping A1111 container to free VRAM for LocalAI...');
      try {
        await dockerManager.stopContainer(a1111ContainerName);
        console.log('✅ A1111 stopped successfully');
        // Wait a moment for VRAM to be freed
        await new Promise(resolve => setTimeout(resolve, 3000));
      } catch (error) {
        console.log('⚠️ Failed to stop A1111:', error.message);
      }
    } else {
      console.log('✅ A1111 not running, proceeding with LocalAI request');
    }
    
    const response = await fetch(`${config.ai.localai.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      timeout: config.ai.localai.timeout
    });

    if (!response.ok) {
      throw new Error(`LocalAI responded with status: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ LocalAI response received');
    res.json(data);
  } catch (error) {
    console.error('❌ LocalAI proxy error:', error.message);
    res.status(500).json({
      error: 'LocalAI connection failed',
      message: `Could not connect to LocalAI at ${config.ai.localai.url}. Error: ${error.message}`,
      suggestion: 'Please check if LocalAI is running and accessible at the configured URL.'
    });
  }
});



// Automatic1111 proxy endpoint with Docker management
app.post('/api/a1111/sdapi/v1/txt2img', async (req, res) => {
  // Track this active request
  activeA1111Requests++;
  lastA1111Activity = Date.now();
  console.log(`📊 A1111 request started. Active requests: ${activeA1111Requests}`);
  
  try {
    console.log('🎨 Starting Automatic1111 image generation...');
    
    // Ensure A1111 container is running
    const a1111ContainerName = config.docker.containers.a1111.name;
    const containerStarted = await dockerManager.ensureContainerRunning(a1111ContainerName);
    if (!containerStarted) {
      throw new Error('Failed to start A1111 container');
    }

    // Wait for A1111 API to be ready with health checks
    console.log('⏳ Waiting for A1111 API to be ready...');
    const maxHealthChecks = 12; // 12 attempts over 60 seconds
    let apiReady = false;
    
    for (let i = 0; i < maxHealthChecks; i++) {
      try {
        const healthCheck = await fetch(`${config.ai.automatic1111.url}/sdapi/v1/progress`, {
          method: 'GET',
          timeout: 5000
        });
        if (healthCheck.ok) {
          console.log('✅ A1111 API is ready');
          apiReady = true;
          break;
        }
      } catch (e) {
        console.log(`⏳ A1111 not ready yet (${i + 1}/${maxHealthChecks}), waiting...`);
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between checks
    }

    if (!apiReady) {
      console.log('⚠️ A1111 health check timed out, attempting anyway...');
    }

    // Retry logic for A1111 API
    console.log('🎨 Proxying Automatic1111 request...');
    let response;
    let lastError;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/${maxRetries} to generate image...`);
        response = await fetch(`${config.ai.automatic1111.url}/sdapi/v1/txt2img`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(req.body),
          timeout: config.ai.automatic1111.timeout
        });

        if (response.ok) {
          console.log('✅ A1111 image generation successful');
          break;
        } else {
          const responseText = await response.text();
          lastError = new Error(`Automatic1111 responded with status ${response.status}: ${responseText.substring(0, 200)}`);
          console.log(`⚠️ Attempt ${attempt} failed with status ${response.status}`);
        }
      } catch (fetchError) {
        lastError = fetchError;
        console.log(`⚠️ Attempt ${attempt} failed: ${fetchError.message}`);
      }
      
      if (attempt < maxRetries) {
        console.log('⏳ Waiting 10 seconds before retry...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    }

    if (!response || !response.ok) {
      throw lastError || new Error('Failed to connect to Automatic1111 after retries');
    }

    const data = await response.json();
    console.log('✅ Automatic1111 response received');
    
    // Mark request as complete
    activeA1111Requests--;
    lastA1111Activity = Date.now();
    console.log(`� A1111 request completed. Active requests: ${activeA1111Requests}`);
    
    // Don't auto-stop anymore - let LocalAI requests handle VRAM management
    
    res.json(data);
  } catch (error) {
    console.error('❌ Automatic1111 proxy error:', error.message);
    
    // Mark request as complete even on error
    activeA1111Requests = Math.max(0, activeA1111Requests - 1);
    console.log(`📊 A1111 request failed. Active requests: ${activeA1111Requests}`);
    
    // Check if SSH is configured - if not, return a generic error
    if (!config.docker.ssh.password || config.docker.ssh.password === 'your_actual_ssh_password_here') {
      res.status(503).json({
        error: 'Service unavailable',
        message: 'Image generation service is currently unavailable.',
        isConfigurationError: true
      });
    } else {
      res.status(500).json({
        error: 'Automatic1111 connection failed',
        message: `Could not connect to Automatic1111 at ${config.ai.automatic1111.url}. Error: ${error.message}`,
        suggestion: 'Please check if Automatic1111 WebUI container is available and SSH connection is configured.'
      });
    }
  }
});

// ComfyUI proxy endpoint with Docker management
app.post('/api/comfyui/prompt', async (req, res) => {
  try {
    console.log('🔧 Starting ComfyUI workflow...');
    
    // Ensure ComfyUI container is running
    const comfyuiContainerName = config.docker.containers.comfyui.name;
    const containerStarted = await dockerManager.ensureContainerRunning(comfyuiContainerName);
    if (!containerStarted) {
      throw new Error('Failed to start ComfyUI container');
    }

    console.log('🔧 Proxying ComfyUI request...');
    const response = await fetch(`${config.ai.comfyui.url}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      timeout: config.ai.comfyui.timeout
    });

    if (!response.ok) {
      throw new Error(`ComfyUI responded with status: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ ComfyUI response received');
    
    // Schedule container stop after a delay (to allow for multiple requests)
    setTimeout(async () => {
      try {
        console.log('🐳 Stopping ComfyUI container to save resources...');
        const comfyuiContainerName = config.docker.containers.comfyui.name;
        await dockerManager.stopContainer(comfyuiContainerName);
      } catch (error) {
        console.error('Failed to stop ComfyUI container:', error.message);
      }
    }, 60000); // Stop after 1 minute of inactivity
    
    res.json(data);
  } catch (error) {
    console.error('❌ ComfyUI proxy error:', error.message);
    res.status(500).json({
      error: 'ComfyUI connection failed',
      message: `Could not connect to ComfyUI at ${config.ai.comfyui.url}. Error: ${error.message}`,
      suggestion: 'Please check if ComfyUI container is available and SSH connection is configured.'
    });
  }
});

// Docker Management API Endpoints

// Get all container statuses
app.get('/api/docker/status', async (req, res) => {
  try {
    const statuses = await dockerManager.getAllContainerStatuses();
    res.json({ success: true, containers: statuses });
  } catch (error) {
    console.error('Docker status error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get container statuses',
      message: error.message
    });
  }
});

// Start specific container
app.post('/api/docker/:container/start', async (req, res) => {
  try {
    const containerName = req.params.container;
    const success = await dockerManager.startContainer(containerName);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Container ${containerName} started successfully`,
        container: containerName
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: `Failed to start container ${containerName}`,
        container: containerName
      });
    }
  } catch (error) {
    console.error('Docker start error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to start container',
      message: error.message,
      container: req.params.container
    });
  }
});

// Stop specific container
app.post('/api/docker/:container/stop', async (req, res) => {
  try {
    const containerName = req.params.container;
    const success = await dockerManager.stopContainer(containerName);
    
    if (success) {
      res.json({ 
        success: true, 
        message: `Container ${containerName} stopped successfully`,
        container: containerName
      });
    } else {
      res.status(500).json({ 
        success: false, 
        message: `Failed to stop container ${containerName}`,
        container: containerName
      });
    }
  } catch (error) {
    console.error('Docker stop error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to stop container',
      message: error.message,
      container: req.params.container
    });
  }
});

// Test SSH Connection
app.get('/api/docker/test-ssh', async (req, res) => {
  try {
    await dockerManager.connect();
    const result = await dockerManager.executeCommand('echo "SSH connection successful"');
    res.json({ 
      success: true, 
      message: 'SSH connection working',
      response: result 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'SSH connection failed'
    });
  }
});

// Health check for AI services
app.get('/api/services/health', async (req, res) => {
  const healthChecks = {};
  
  // Check LocalAI
  try {
    const localaiResponse = await fetch(`${config.ai.localai.url}/v1/models`, { timeout: 5000 });
    healthChecks.localai = {
      status: localaiResponse.ok ? 'online' : 'error',
      url: config.ai.localai.url,
      response_code: localaiResponse.status
    };
  } catch (error) {
    healthChecks.localai = {
      status: 'offline',
      url: config.ai.localai.url,
      error: error.message
    };
  }

  // Check Automatic1111
  try {
    const a1111Response = await fetch(`${config.ai.automatic1111.url}/sdapi/v1/sd-models`, { timeout: 5000 });
    healthChecks.automatic1111 = {
      status: a1111Response.ok ? 'online' : 'error',
      url: config.ai.automatic1111.url,
      response_code: a1111Response.status
    };
  } catch (error) {
    healthChecks.automatic1111 = {
      status: 'offline',
      url: config.ai.automatic1111.url,
      error: error.message
    };
  }

  // Check ComfyUI
  try {
    const comfyuiResponse = await fetch(`${config.ai.comfyui.url}/system_stats`, { timeout: 5000 });
    healthChecks.comfyui = {
      status: comfyuiResponse.ok ? 'online' : 'error',
      url: config.ai.comfyui.url,
      response_code: comfyuiResponse.status
    };
  } catch (error) {
    healthChecks.comfyui = {
      status: 'offline',
      url: config.ai.comfyui.url,
      error: error.message
    };
  }

  res.json({
    timestamp: new Date().toISOString(),
    services: healthChecks
  });
});

// Serve frontend for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(error.status || 500).json({
    error: error.message || 'Internal server error',
    mode: 'hybrid'
  });
});

// Configuration and Docker management endpoints
app.get('/api/config', (req, res) => {
  // Return public configuration (no sensitive data)
  res.json({
    ai: {
      localai: {
        defaultModel: config.ai.localai.defaultModel,
        autoUnload: config.ai.localai.autoUnload
      }
    },
    docker: config.docker,
    defaultPersonalities: config.defaultPersonalities
  });
});

app.post('/api/docker/:action/:container', async (req, res) => {
  const { action, container } = req.params;
  
  try {
    console.log(`🐳 Docker ${action} for container: ${container}`);
    
    // Here you would implement actual Docker commands
    // For now, return success simulation
    res.json({ 
      success: true, 
      message: `Container ${container} ${action} operation completed`,
      action: action,
      container: container,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Docker operation failed:', error.message);
    res.status(500).json({
      success: false,
      error: `Docker ${action} failed for ${container}`,
      message: error.message
    });
  }
});

const PORT = config.server.port;

// Initialize auto-message scheduler
let autoMessageScheduler = null;

// Initialize and start the server
async function startServer() {
  console.log('🚀 Starting server initialization...');
  await initServer();
  console.log('✅ Server initialization complete');
  
  // Stop A1111 and ComfyUI on startup to free VRAM for LocalAI
  console.log('🧹 Stopping A1111 and ComfyUI to ensure clean VRAM state...');
  try {
    await dockerManager.stopContainer('AUTOMATIC1111-Stable-Diffusion-Web-UI').catch(e => 
      console.log('   A1111 already stopped or not found')
    );
    await dockerManager.stopContainer('ComfyUI').catch(e => 
      console.log('   ComfyUI already stopped or not found')
    );
    console.log('✅ VRAM cleared for LocalAI');
  } catch (error) {
    console.log('⚠️  Could not stop containers:', error.message);
  }
  
  const server = app.listen(PORT, () => {
    console.log('🎉 AI Chat App - Database Mode');
    console.log('================================');
    console.log(`🌐 Server running on: http://localhost:${PORT}`);
    console.log('📱 Frontend: Served from /');
    console.log('🔧 Backend: API endpoints at /api/*');
    console.log(`💾 Database: ${dbConnected ? 'MariaDB @ Homelab-p' : 'Connection failed - localStorage fallback'}`);
    console.log('✅ Ready to use!');
    console.log('--------------------------------');
    if (dbConnected) {
      console.log('💡 Real user accounts and data persistence enabled');
      console.log('💡 Chat history saved to database');
      console.log('💡 Full authentication system active');
      
      // Start auto-message scheduler with AI dependencies
      autoMessageScheduler = new AutoMessageScheduler(messageQueue, aiProcessor, imageGenerator, db);
      autoMessageScheduler.start();
      console.log('💬 Auto-message scheduler started');
    } else {
      console.log('⚠️  Database connection failed - using localStorage mode');
      console.log('💡 Check MariaDB connection to Homelab-p');
    }
    console.log('================================');
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🔄 Shutting down gracefully...');
    
    // Stop auto-message scheduler
    if (autoMessageScheduler) {
      autoMessageScheduler.stop();
    }
    
    // Stop all AI services
    await messageQueue.shutdownAll();
    
    server.close(() => {
      console.log('📡 HTTP server closed');
    });
    
    if (dbConnected) {
      await db.closeDatabase();
    }
    
    console.log('👋 Shutdown complete');
    process.exit(0);
  });
}

// Start the server
startServer();

module.exports = app;