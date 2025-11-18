const express = require('express');
const { body, validationResult } = require('express-validator');
const config = require('../config');
const { query } = require('../database/postgres');
const { authenticateToken, requireActiveUser } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

// Apply authentication to all settings routes
router.use(authenticateToken, requireActiveUser);

// Validation rules
const settingsValidation = [
  body('localaIUrl')
    .optional()
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('LocalAI URL must be a valid HTTP/HTTPS URL'),
  body('a1111Url')
    .optional()
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('Automatic1111 URL must be a valid HTTP/HTTPS URL'),
  body('comfyuiUrl')
    .optional()
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('ComfyUI URL must be a valid HTTP/HTTPS URL'),
  body('themePreference')
    .optional()
    .isIn(['light', 'dark', 'auto'])
    .withMessage('Theme preference must be "light", "dark", or "auto"'),
  body('autoGenerateAvatars')
    .optional()
    .isBoolean()
    .withMessage('Auto generate avatars must be a boolean'),
  body('defaultPersonalityId')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Default personality ID must be a positive integer')
];

/**
 * Get user settings
 */
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT us.localai_url, us.a1111_url, us.comfyui_url, us.default_personality_id,
              us.theme_preference, us.auto_generate_avatars, us.created_at, us.updated_at,
              p.name as default_personality_name, p.avatar_data as default_personality_avatar
       FROM user_settings us
       LEFT JOIN personalities p ON us.default_personality_id = p.id
       WHERE us.user_id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      // Create default settings if they don't exist
      await query(
        'INSERT INTO user_settings (user_id) VALUES ($1)',
        [req.user.id]
      );

      // Return default settings
      return res.json({
        settings: {
          localaIUrl: config.aiServices.localai.url,
          a1111Url: config.aiServices.automatic1111.url,
          comfyuiUrl: config.aiServices.comfyui.url,
          themePreference: 'dark',
          autoGenerateAvatars: true,
          defaultPersonalityId: null,
          defaultPersonality: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });
    }

    const settings = result.rows[0];

    res.json({
      settings: {
        localaIUrl: settings.localai_url || config.aiServices.localai.url,
        a1111Url: settings.a1111_url || config.aiServices.automatic1111.url,
        comfyuiUrl: settings.comfyui_url || config.aiServices.comfyui.url,
        themePreference: settings.theme_preference || 'dark',
        autoGenerateAvatars: settings.auto_generate_avatars !== false, // Default to true
        defaultPersonalityId: settings.default_personality_id,
        defaultPersonality: settings.default_personality_id ? {
          id: settings.default_personality_id,
          name: settings.default_personality_name,
          avatarData: settings.default_personality_avatar
        } : null,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });

  } catch (error) {
    console.error('Fetch settings error:', error);
    res.status(500).json({
      error: 'Failed to fetch settings',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Update user settings
 */
router.put('/', settingsValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      localaIUrl,
      a1111Url,
      comfyuiUrl,
      themePreference,
      autoGenerateAvatars,
      defaultPersonalityId
    } = req.body;

    // Validate personality ownership if provided
    if (defaultPersonalityId) {
      const personalityResult = await query(
        'SELECT id FROM personalities WHERE id = $1 AND user_id = $2',
        [defaultPersonalityId, req.user.id]
      );

      if (personalityResult.rows.length === 0) {
        return res.status(400).json({
          error: 'Invalid personality',
          message: 'The specified default personality does not exist or you do not have access to it'
        });
      }
    }

    // Update settings (upsert)
    const result = await query(
      `INSERT INTO user_settings (
        user_id, localai_url, a1111_url, comfyui_url, theme_preference,
        auto_generate_avatars, default_personality_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) DO UPDATE SET
        localai_url = COALESCE($2, user_settings.localai_url),
        a1111_url = COALESCE($3, user_settings.a1111_url),
        comfyui_url = COALESCE($4, user_settings.comfyui_url),
        theme_preference = COALESCE($5, user_settings.theme_preference),
        auto_generate_avatars = COALESCE($6, user_settings.auto_generate_avatars),
        default_personality_id = $7,
        updated_at = CURRENT_TIMESTAMP
      RETURNING localai_url, a1111_url, comfyui_url, theme_preference,
                auto_generate_avatars, default_personality_id, created_at, updated_at`,
      [
        req.user.id,
        localaIUrl || null,
        a1111Url || null,
        comfyuiUrl || null,
        themePreference || null,
        autoGenerateAvatars !== undefined ? autoGenerateAvatars : null,
        defaultPersonalityId || null
      ]
    );

    const settings = result.rows[0];

    // Get default personality info if set
    let defaultPersonality = null;
    if (settings.default_personality_id) {
      const personalityResult = await query(
        'SELECT id, name, avatar_data FROM personalities WHERE id = $1',
        [settings.default_personality_id]
      );
      if (personalityResult.rows.length > 0) {
        const p = personalityResult.rows[0];
        defaultPersonality = {
          id: p.id,
          name: p.name,
          avatarData: p.avatar_data
        };
      }
    }

    res.json({
      message: 'Settings updated successfully',
      settings: {
        localaIUrl: settings.localai_url || config.aiServices.localai.url,
        a1111Url: settings.a1111_url || config.aiServices.automatic1111.url,
        comfyuiUrl: settings.comfyui_url || config.aiServices.comfyui.url,
        themePreference: settings.theme_preference || 'dark',
        autoGenerateAvatars: settings.auto_generate_avatars !== false,
        defaultPersonalityId: settings.default_personality_id,
        defaultPersonality,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });

  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      error: 'Failed to update settings',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Test AI service connection
 */
router.post('/test-connection', [
  body('service')
    .isIn(['localai', 'automatic1111', 'comfyui'])
    .withMessage('Service must be one of: localai, automatic1111, comfyui'),
  body('url')
    .isURL({ protocols: ['http', 'https'] })
    .withMessage('URL must be a valid HTTP/HTTPS URL')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { service, url } = req.body;

    let testEndpoint;
    let testPayload = null;
    let expectedStatus = 200;

    switch (service) {
      case 'localai':
        testEndpoint = `${url}/v1/models`;
        break;
      case 'automatic1111':
        testEndpoint = `${url}/sdapi/v1/samplers`;
        break;
      case 'comfyui':
        testEndpoint = `${url}/system_stats`;
        break;
      default:
        return res.status(400).json({
          error: 'Invalid service',
          message: 'Unknown service type'
        });
    }

    try {
      const response = await axios.get(testEndpoint, {
        timeout: 10000, // 10 seconds
        headers: {
          'Content-Type': 'application/json',
          ...(service === 'localai' && { 'Authorization': 'Bearer dummy-token' })
        }
      });

      res.json({
        success: true,
        message: `Successfully connected to ${service}`,
        service,
        url,
        status: response.status,
        responseTime: Date.now() // This would need proper timing in real implementation
      });

    } catch (connectionError) {
      console.error(`${service} connection test failed:`, connectionError.message);

      let errorMessage = 'Connection failed';
      let errorDetails = connectionError.message;

      if (connectionError.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused - service may not be running';
      } else if (connectionError.code === 'ENOTFOUND') {
        errorMessage = 'Host not found - check URL';
      } else if (connectionError.code === 'ETIMEDOUT') {
        errorMessage = 'Connection timeout - service may be slow to respond';
      }

      res.status(503).json({
        success: false,
        message: errorMessage,
        service,
        url,
        error: errorDetails
      });
    }

  } catch (error) {
    console.error('Test connection error:', error);
    res.status(500).json({
      error: 'Failed to test connection',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Get AI service status
 */
router.get('/service-status', async (req, res) => {
  try {
    // Get user's service URLs
    const settingsResult = await query(
      'SELECT localai_url, a1111_url, comfyui_url FROM user_settings WHERE user_id = $1',
      [req.user.id]
    );

    const settings = settingsResult.rows[0] || {};
    const services = {
      localai: settings.localai_url || config.aiServices.localai.url,
      automatic1111: settings.a1111_url || config.aiServices.automatic1111.url,
      comfyui: settings.comfyui_url || config.aiServices.comfyui.url
    };

    const statusPromises = Object.entries(services).map(async ([service, url]) => {
      let testEndpoint;
      
      switch (service) {
        case 'localai':
          testEndpoint = `${url}/v1/models`;
          break;
        case 'automatic1111':
          testEndpoint = `${url}/sdapi/v1/samplers`;
          break;
        case 'comfyui':
          testEndpoint = `${url}/system_stats`;
          break;
      }

      try {
        const startTime = Date.now();
        const response = await axios.get(testEndpoint, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
            ...(service === 'localai' && { 'Authorization': 'Bearer dummy-token' })
          }
        });
        const responseTime = Date.now() - startTime;

        return {
          service,
          url,
          status: 'online',
          responseTime,
          statusCode: response.status
        };
      } catch (error) {
        return {
          service,
          url,
          status: 'offline',
          error: error.message,
          statusCode: error.response?.status || null
        };
      }
    });

    const statuses = await Promise.all(statusPromises);

    res.json({
      services: statuses,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Service status error:', error);
    res.status(500).json({
      error: 'Failed to check service status',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Reset settings to defaults
 */
router.post('/reset', async (req, res) => {
  try {
    // Reset to default settings
    const result = await query(
      `UPDATE user_settings SET
        localai_url = NULL,
        a1111_url = NULL,
        comfyui_url = NULL,
        theme_preference = 'dark',
        auto_generate_avatars = true,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING localai_url, a1111_url, comfyui_url, theme_preference,
                auto_generate_avatars, default_personality_id, created_at, updated_at`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Settings not found',
        message: 'User settings not found'
      });
    }

    const settings = result.rows[0];

    res.json({
      message: 'Settings reset to defaults successfully',
      settings: {
        localaIUrl: config.aiServices.localai.url,
        a1111Url: config.aiServices.automatic1111.url,
        comfyuiUrl: config.aiServices.comfyui.url,
        themePreference: settings.theme_preference,
        autoGenerateAvatars: settings.auto_generate_avatars,
        defaultPersonalityId: settings.default_personality_id,
        defaultPersonality: null,
        createdAt: settings.created_at,
        updatedAt: settings.updated_at
      }
    });

  } catch (error) {
    console.error('Reset settings error:', error);
    res.status(500).json({
      error: 'Failed to reset settings',
      message: 'An internal server error occurred'
    });
  }
});

module.exports = router;