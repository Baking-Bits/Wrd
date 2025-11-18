const express = require('express');
const { body, param, query: queryValidator, validationResult } = require('express-validator');
const config = require('../config');
const { query, transaction } = require('../database/postgres');
const { authenticateToken, requireActiveUser } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

// Apply authentication to all chat routes
router.use(authenticateToken, requireActiveUser);

// Validation rules
const sessionValidation = [
  body('sessionName')
    .optional()
    .isLength({ min: 1, max: 200 })
    .withMessage('Session name must be between 1 and 200 characters'),
  body('personalityId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Personality ID must be a positive integer')
];

const messageValidation = [
  body('content')
    .isLength({ min: 1, max: 10000 })
    .withMessage('Message content must be between 1 and 10000 characters'),
  body('messageType')
    .optional()
    .isIn(['user', 'system'])
    .withMessage('Message type must be either "user" or "system"')
];

const idValidation = [
  param('id').isInt({ min: 1 }).withMessage('Invalid session ID')
];

/**
 * Get all chat sessions for the current user
 */
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) as total FROM chat_sessions WHERE user_id = $1',
      [req.user.id]
    );
    const total = parseInt(countResult.rows[0].total);

    // Get sessions with personality info
    const result = await query(
      `SELECT cs.id, cs.session_name, cs.created_at, cs.last_message_at,
              p.id as personality_id, p.name as personality_name, p.avatar_data,
              (SELECT COUNT(*) FROM chat_messages WHERE session_id = cs.id) as message_count
       FROM chat_sessions cs
       LEFT JOIN personalities p ON cs.personality_id = p.id
       WHERE cs.user_id = $1
       ORDER BY cs.last_message_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );

    const sessions = result.rows.map(row => ({
      id: row.id,
      sessionName: row.session_name,
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at,
      messageCount: parseInt(row.message_count),
      personality: row.personality_id ? {
        id: row.personality_id,
        name: row.personality_name,
        avatarData: row.avatar_data
      } : null
    }));

    res.json({
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Fetch chat sessions error:', error);
    res.status(500).json({
      error: 'Failed to fetch chat sessions',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Get a specific chat session by ID
 */
router.get('/:id', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const result = await query(
      `SELECT cs.id, cs.session_name, cs.created_at, cs.last_message_at,
              p.id as personality_id, p.name as personality_name, 
              p.avatar_data, p.system_prompt
       FROM chat_sessions cs
       LEFT JOIN personalities p ON cs.personality_id = p.id
       WHERE cs.id = $1 AND cs.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Chat session not found',
        message: 'The requested chat session does not exist or you do not have access to it'
      });
    }

    const session = result.rows[0];

    res.json({
      session: {
        id: session.id,
        sessionName: session.session_name,
        createdAt: session.created_at,
        lastMessageAt: session.last_message_at,
        personality: session.personality_id ? {
          id: session.personality_id,
          name: session.personality_name,
          avatarData: session.avatar_data,
          systemPrompt: session.system_prompt
        } : null
      }
    });

  } catch (error) {
    console.error('Fetch chat session error:', error);
    res.status(500).json({
      error: 'Failed to fetch chat session',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Create a new chat session
 */
router.post('/', sessionValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { sessionName, personalityId } = req.body;

    // Check session limit
    const countResult = await query(
      'SELECT COUNT(*) as count FROM chat_sessions WHERE user_id = $1',
      [req.user.id]
    );

    const sessionCount = parseInt(countResult.rows[0].count);
    if (sessionCount >= config.app.maxChatSessionsPerUser) {
      return res.status(429).json({
        error: 'Session limit reached',
        message: `You can have a maximum of ${config.app.maxChatSessionsPerUser} chat sessions`
      });
    }

    // Validate personality ownership if provided
    if (personalityId) {
      const personalityResult = await query(
        'SELECT id FROM personalities WHERE id = $1 AND user_id = $2',
        [personalityId, req.user.id]
      );

      if (personalityResult.rows.length === 0) {
        return res.status(400).json({
          error: 'Invalid personality',
          message: 'The specified personality does not exist or you do not have access to it'
        });
      }
    }

    // Create session
    const result = await query(
      `INSERT INTO chat_sessions (user_id, personality_id, session_name, created_at, last_message_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING id, session_name, created_at, last_message_at`,
      [req.user.id, personalityId || null, sessionName || `Chat ${new Date().toLocaleString()}`]
    );

    const session = result.rows[0];

    // Get personality info if provided
    let personality = null;
    if (personalityId) {
      const personalityResult = await query(
        'SELECT id, name, avatar_data, system_prompt FROM personalities WHERE id = $1',
        [personalityId]
      );
      if (personalityResult.rows.length > 0) {
        const p = personalityResult.rows[0];
        personality = {
          id: p.id,
          name: p.name,
          avatarData: p.avatar_data,
          systemPrompt: p.system_prompt
        };
      }
    }

    res.status(201).json({
      message: 'Chat session created successfully',
      session: {
        id: session.id,
        sessionName: session.session_name,
        createdAt: session.created_at,
        lastMessageAt: session.last_message_at,
        personality
      }
    });

  } catch (error) {
    console.error('Create chat session error:', error);
    res.status(500).json({
      error: 'Failed to create chat session',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Update chat session
 */
router.put('/:id', idValidation, sessionValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { sessionName, personalityId } = req.body;

    // Check if session exists and belongs to user
    const existingResult = await query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Chat session not found',
        message: 'The requested chat session does not exist or you do not have access to it'
      });
    }

    // Validate personality ownership if provided
    if (personalityId) {
      const personalityResult = await query(
        'SELECT id FROM personalities WHERE id = $1 AND user_id = $2',
        [personalityId, req.user.id]
      );

      if (personalityResult.rows.length === 0) {
        return res.status(400).json({
          error: 'Invalid personality',
          message: 'The specified personality does not exist or you do not have access to it'
        });
      }
    }

    // Update session
    const result = await query(
      `UPDATE chat_sessions SET
        session_name = COALESCE($1, session_name),
        personality_id = $2
       WHERE id = $3 AND user_id = $4
       RETURNING id, session_name, created_at, last_message_at`,
      [sessionName, personalityId || null, req.params.id, req.user.id]
    );

    const session = result.rows[0];

    res.json({
      message: 'Chat session updated successfully',
      session: {
        id: session.id,
        sessionName: session.session_name,
        createdAt: session.created_at,
        lastMessageAt: session.last_message_at
      }
    });

  } catch (error) {
    console.error('Update chat session error:', error);
    res.status(500).json({
      error: 'Failed to update chat session',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Delete chat session
 */
router.delete('/:id', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Delete session in a transaction (messages are deleted by foreign key constraint)
    const result = await query(
      'DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Chat session not found',
        message: 'The requested chat session does not exist or you do not have access to it'
      });
    }

    res.json({
      message: 'Chat session deleted successfully'
    });

  } catch (error) {
    console.error('Delete chat session error:', error);
    res.status(500).json({
      error: 'Failed to delete chat session',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Get messages from a chat session
 */
router.get('/:id/messages', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if session exists and belongs to user
    const sessionResult = await query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Chat session not found',
        message: 'The requested chat session does not exist or you do not have access to it'
      });
    }

    // Support both page-based and offset-based pagination
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const page = Math.floor(offset / limit) + 1;

    // Get total count first
    const countResult = await query(
      'SELECT COUNT(*) as total FROM chat_messages WHERE session_id = $1',
      [req.params.id]
    );
    const total = parseInt(countResult.rows[0].total);

    // Get messages in DESC order (newest first) with offset from the END
    // This allows infinite scroll loading of older messages
    const result = await query(
      `SELECT id, message_type, content, metadata, created_at
       FROM chat_messages
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, offset]
    );

    // Reverse to get chronological order (oldest to newest) for display
    const messages = result.rows.reverse().map(row => ({
      id: row.id,
      messageType: row.message_type,
      content: row.content,
      metadata: row.metadata || {},
      createdAt: row.created_at
    }));

    res.json({
      messages,
      pagination: {
        page,
        limit,
        offset,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: (offset + limit) < total
      }
    });

  } catch (error) {
    console.error('Fetch messages error:', error);
    res.status(500).json({
      error: 'Failed to fetch messages',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Delete a specific message from a chat session
 */
router.delete('/:id/messages/:messageId', [
  param('id').isInt({ min: 1 }).withMessage('Invalid session ID'),
  param('messageId').isInt({ min: 1 }).withMessage('Invalid message ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if session exists and belongs to user
    const sessionResult = await query(
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Chat session not found',
        message: 'The requested chat session does not exist or you do not have access to it'
      });
    }

    // Delete the message (verify it belongs to the session)
    const result = await query(
      'DELETE FROM chat_messages WHERE id = $1 AND session_id = $2 RETURNING id',
      [req.params.messageId, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Message not found',
        message: 'The requested message does not exist in this chat session'
      });
    }

    res.json({
      success: true,
      message: 'Message deleted successfully',
      messageId: parseInt(req.params.messageId)
    });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      error: 'Failed to delete message',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Send a message to AI and get response
 */
router.post('/:id/messages', idValidation, messageValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { content, messageType = 'user' } = req.body;

    // Check if session exists and belongs to user, get personality
    const sessionResult = await query(
      `SELECT cs.id, p.id as personality_id, p.name as personality_name, 
              p.system_prompt, p.avatar_data
       FROM chat_sessions cs
       LEFT JOIN personalities p ON cs.personality_id = p.id
       WHERE cs.id = $1 AND cs.user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (sessionResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Chat session not found',
        message: 'The requested chat session does not exist or you do not have access to it'
      });
    }

    const session = sessionResult.rows[0];

    // Check message count limit
    const messageCountResult = await query(
      'SELECT COUNT(*) as count FROM chat_messages WHERE session_id = $1',
      [req.params.id]
    );

    const messageCount = parseInt(messageCountResult.rows[0].count);
    if (messageCount >= config.app.maxMessagesPerSession) {
      return res.status(429).json({
        error: 'Message limit reached',
        message: `This chat session has reached the maximum of ${config.app.maxMessagesPerSession} messages`
      });
    }

    // Store user message
    const userMessageResult = await query(
      `INSERT INTO chat_messages (session_id, message_type, content, created_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       RETURNING id, created_at`,
      [req.params.id, messageType, content]
    );

    const userMessage = {
      id: userMessageResult.rows[0].id,
      messageType,
      content,
      metadata: {},
      createdAt: userMessageResult.rows[0].created_at
    };

    // Get conversation history for context
    const historyResult = await query(
      `SELECT message_type, content FROM chat_messages 
       WHERE session_id = $1 
       ORDER BY created_at ASC 
       LIMIT 20`,
      [req.params.id]
    );

    // Build conversation context
    const messages = [];
    
    // Add system prompt if personality exists
    if (session.personality_id && session.system_prompt) {
      messages.push({
        role: 'system',
        content: session.system_prompt
      });
    }

    // Add conversation history
    historyResult.rows.forEach(row => {
      messages.push({
        role: row.message_type === 'user' ? 'user' : 'assistant',
        content: row.content
      });
    });

    try {
      // Get user settings for LocalAI URL
      const settingsResult = await query(
        'SELECT localai_url FROM user_settings WHERE user_id = $1',
        [req.user.id]
      );

      const localaIUrl = settingsResult.rows[0]?.localai_url || config.aiServices.localai.url;

      // Send to LocalAI
      const aiResponse = await axios.post(`${localaIUrl}/v1/chat/completions`, {
        model: 'gpt-4', // This should match your LocalAI model name
        messages: messages,
        max_tokens: 2048,
        temperature: 0.7,
        stream: false
      }, {
        timeout: config.aiServices.localai.timeout,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer dummy-token'
        }
      });

      if (!aiResponse.data.choices || aiResponse.data.choices.length === 0) {
        throw new Error('No response from AI');
      }

      const aiContent = aiResponse.data.choices[0].message.content;
      const usage = aiResponse.data.usage || {};

      // Store AI response
      const aiMessageResult = await query(
        `INSERT INTO chat_messages (session_id, message_type, content, metadata, created_at)
         VALUES ($1, 'assistant', $2, $3, CURRENT_TIMESTAMP)
         RETURNING id, created_at`,
        [
          req.params.id,
          aiContent,
          JSON.stringify({
            model: aiResponse.data.model,
            usage: usage,
            personality: session.personality_name
          })
        ]
      );

      const aiMessage = {
        id: aiMessageResult.rows[0].id,
        messageType: 'assistant',
        content: aiContent,
        metadata: {
          model: aiResponse.data.model,
          usage: usage,
          personality: session.personality_name
        },
        createdAt: aiMessageResult.rows[0].created_at
      };

      res.json({
        message: 'Message sent successfully',
        userMessage,
        aiResponse: aiMessage
      });

    } catch (aiError) {
      console.error('AI response error:', aiError);
      
      if (aiError.code === 'ECONNREFUSED' || aiError.code === 'ENOTFOUND') {
        return res.status(503).json({
          error: 'AI service unavailable',
          message: 'The AI service is currently unavailable. Please try again later.',
          userMessage
        });
      }

      return res.status(500).json({
        error: 'AI response failed',
        message: 'Failed to get AI response. Your message has been saved.',
        userMessage
      });
    }

  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      error: 'Failed to send message',
      message: 'An internal server error occurred'
    });
  }
});

module.exports = router;