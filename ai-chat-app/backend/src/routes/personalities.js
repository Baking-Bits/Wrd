const express = require('express');
const { body, param, validationResult } = require('express-validator');
const config = require('../config');
const { query, transaction } = require('../database/postgres');
const { authenticateToken, requireActiveUser } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

// Apply authentication to all personality routes
router.use(authenticateToken, requireActiveUser);

// Validation rules
const personalityValidation = [
  body('name')
    .isLength({ min: 1, max: 100 })
    .withMessage('Personality name must be between 1 and 100 characters')
    .matches(/^[a-zA-Z0-9\s\-_'".!?]+$/)
    .withMessage('Personality name contains invalid characters'),
  body('description')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Description must be 500 characters or less'),
  body('systemPrompt')
    .isLength({ min: 10, max: 5000 })
    .withMessage('System prompt must be between 10 and 5000 characters'),
  body('personalityTraits')
    .optional()
    .isArray({ max: 20 })
    .withMessage('Personality traits must be an array with maximum 20 items'),
  body('personalityTraits.*')
    .optional()
    .isString()
    .isLength({ min: 1, max: 100 })
    .withMessage('Each trait must be a string between 1 and 100 characters'),
  body('backgroundInfo')
    .optional()
    .isObject()
    .withMessage('Background info must be an object'),
  body('avatarPrompt')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Avatar prompt must be 1000 characters or less')
];

const idValidation = [
  param('id').isInt({ min: 1 }).withMessage('Invalid personality ID')
];

/**
 * Get all personalities for the current user
 */
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, description, system_prompt, avatar_data, avatar_prompt,
              personality_traits, background_info, is_default, created_at, updated_at
       FROM personalities 
       WHERE user_id = $1 
       ORDER BY is_default DESC, name ASC`,
      [req.user.id]
    );

    const personalities = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      avatarData: row.avatar_data,
      avatarPrompt: row.avatar_prompt,
      personalityTraits: row.personality_traits || [],
      backgroundInfo: row.background_info || {},
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    res.json({
      personalities,
      total: personalities.length
    });

  } catch (error) {
    console.error('Fetch personalities error:', error);
    res.status(500).json({
      error: 'Failed to fetch personalities',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Get a specific personality by ID
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
      `SELECT id, name, description, system_prompt, avatar_data, avatar_prompt,
              personality_traits, background_info, is_default, created_at, updated_at
       FROM personalities 
       WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Personality not found',
        message: 'The requested personality does not exist or you do not have access to it'
      });
    }

    const personality = result.rows[0];

    res.json({
      personality: {
        id: personality.id,
        name: personality.name,
        description: personality.description,
        systemPrompt: personality.system_prompt,
        avatarData: personality.avatar_data,
        avatarPrompt: personality.avatar_prompt,
        personalityTraits: personality.personality_traits || [],
        backgroundInfo: personality.background_info || {},
        isDefault: personality.is_default,
        createdAt: personality.created_at,
        updatedAt: personality.updated_at
      }
    });

  } catch (error) {
    console.error('Fetch personality error:', error);
    res.status(500).json({
      error: 'Failed to fetch personality',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Create a new personality
 */
router.post('/', personalityValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      name,
      description,
      systemPrompt,
      personalityTraits = [],
      backgroundInfo = {},
      avatarPrompt
    } = req.body;

    // Check if user already has a personality with this name
    const existingResult = await query(
      'SELECT id FROM personalities WHERE user_id = $1 AND name = $2',
      [req.user.id, name]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        error: 'Personality name already exists',
        message: 'You already have a personality with this name'
      });
    }

    // Check personality limit
    const countResult = await query(
      'SELECT COUNT(*) as count FROM personalities WHERE user_id = $1',
      [req.user.id]
    );

    const personalityCount = parseInt(countResult.rows[0].count);
    if (personalityCount >= config.app.maxPersonalitiesPerUser) {
      return res.status(429).json({
        error: 'Personality limit reached',
        message: `You can have a maximum of ${config.app.maxPersonalitiesPerUser} personalities`
      });
    }

    // Create personality
    const result = await query(
      `INSERT INTO personalities (
        user_id, name, description, system_prompt, avatar_prompt,
        personality_traits, background_info, is_default, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, name, description, system_prompt, avatar_prompt,
                personality_traits, background_info, is_default, created_at, updated_at`,
      [
        req.user.id,
        name,
        description || null,
        systemPrompt,
        avatarPrompt || null,
        JSON.stringify(personalityTraits),
        JSON.stringify(backgroundInfo)
      ]
    );

    const personality = result.rows[0];

    res.status(201).json({
      message: 'Personality created successfully',
      personality: {
        id: personality.id,
        name: personality.name,
        description: personality.description,
        systemPrompt: personality.system_prompt,
        avatarData: null,
        avatarPrompt: personality.avatar_prompt,
        personalityTraits: personality.personality_traits || [],
        backgroundInfo: personality.background_info || {},
        isDefault: personality.is_default,
        createdAt: personality.created_at,
        updatedAt: personality.updated_at
      }
    });

  } catch (error) {
    console.error('Create personality error:', error);
    res.status(500).json({
      error: 'Failed to create personality',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Update a personality
 */
router.put('/:id', idValidation, personalityValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const {
      name,
      description,
      systemPrompt,
      personalityTraits = [],
      backgroundInfo = {},
      avatarPrompt
    } = req.body;

    // Check if personality exists and belongs to user
    const existingResult = await query(
      'SELECT id, name, avatar_data FROM personalities WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Personality not found',
        message: 'The requested personality does not exist or you do not have access to it'
      });
    }

    const existingPersonality = existingResult.rows[0];

    // Check if name is being changed and if new name already exists
    if (name !== existingPersonality.name) {
      const nameCheckResult = await query(
        'SELECT id FROM personalities WHERE user_id = $1 AND name = $2 AND id != $3',
        [req.user.id, name, req.params.id]
      );

      if (nameCheckResult.rows.length > 0) {
        return res.status(409).json({
          error: 'Personality name already exists',
          message: 'You already have a personality with this name'
        });
      }
    }

    // Update personality
    const result = await query(
      `UPDATE personalities SET
        name = $1,
        description = $2,
        system_prompt = $3,
        avatar_prompt = $4,
        personality_traits = $5,
        background_info = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7 AND user_id = $8
      RETURNING id, name, description, system_prompt, avatar_data, avatar_prompt,
                personality_traits, background_info, is_default, created_at, updated_at`,
      [
        name,
        description || null,
        systemPrompt,
        avatarPrompt || null,
        JSON.stringify(personalityTraits),
        JSON.stringify(backgroundInfo),
        req.params.id,
        req.user.id
      ]
    );

    const personality = result.rows[0];

    res.json({
      message: 'Personality updated successfully',
      personality: {
        id: personality.id,
        name: personality.name,
        description: personality.description,
        systemPrompt: personality.system_prompt,
        avatarData: personality.avatar_data,
        avatarPrompt: personality.avatar_prompt,
        personalityTraits: personality.personality_traits || [],
        backgroundInfo: personality.background_info || {},
        isDefault: personality.is_default,
        createdAt: personality.created_at,
        updatedAt: personality.updated_at
      }
    });

  } catch (error) {
    console.error('Update personality error:', error);
    res.status(500).json({
      error: 'Failed to update personality',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Delete a personality
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

    // Check if personality exists and belongs to user
    const existingResult = await query(
      'SELECT id, is_default FROM personalities WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Personality not found',
        message: 'The requested personality does not exist or you do not have access to it'
      });
    }

    const personality = existingResult.rows[0];

    // Prevent deletion of default personality
    if (personality.is_default) {
      return res.status(400).json({
        error: 'Cannot delete default personality',
        message: 'The default personality cannot be deleted. Set another personality as default first.'
      });
    }

    // Delete personality in a transaction (also deletes related chat sessions due to foreign key)
    await transaction(async (client) => {
      // Delete the personality
      await client.query(
        'DELETE FROM personalities WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );
    });

    res.json({
      message: 'Personality deleted successfully'
    });

  } catch (error) {
    console.error('Delete personality error:', error);
    res.status(500).json({
      error: 'Failed to delete personality',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Set a personality as default
 */
router.post('/:id/set-default', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if personality exists and belongs to user
    const existingResult = await query(
      'SELECT id FROM personalities WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Personality not found',
        message: 'The requested personality does not exist or you do not have access to it'
      });
    }

    // Update default personality in a transaction
    await transaction(async (client) => {
      // Remove default flag from all personalities
      await client.query(
        'UPDATE personalities SET is_default = false WHERE user_id = $1',
        [req.user.id]
      );

      // Set new default personality
      await client.query(
        'UPDATE personalities SET is_default = true WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
      );

      // Update user settings
      await client.query(
        'UPDATE user_settings SET default_personality_id = $1 WHERE user_id = $2',
        [req.params.id, req.user.id]
      );
    });

    res.json({
      message: 'Default personality updated successfully'
    });

  } catch (error) {
    console.error('Set default personality error:', error);
    res.status(500).json({
      error: 'Failed to set default personality',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Generate avatar for a personality
 */
router.post('/:id/generate-avatar', idValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    // Check if personality exists and belongs to user
    const personalityResult = await query(
      'SELECT id, name, avatar_prompt, personality_traits FROM personalities WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (personalityResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Personality not found',
        message: 'The requested personality does not exist or you do not have access to it'
      });
    }

    const personality = personalityResult.rows[0];

    // Generate avatar prompt if not provided
    let avatarPrompt = personality.avatar_prompt;
    if (!avatarPrompt) {
      const traits = personality.personality_traits || [];
      avatarPrompt = `Portrait of ${personality.name}, ${traits.slice(0, 3).join(', ')}, detailed character art, professional quality`;
    }

    // Call Automatic1111 API for image generation
    try {
      const imageResponse = await axios.post(`${config.aiServices.automatic1111.url}/sdapi/v1/txt2img`, {
        prompt: avatarPrompt,
        negative_prompt: 'blurry, low quality, distorted, deformed, watermark, text',
        width: 512,
        height: 512,
        steps: 20,
        cfg_scale: 7,
        sampler_name: 'DPM++ 2M Karras',
        batch_size: 1,
        n_iter: 1
      }, {
        timeout: config.aiServices.automatic1111.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!imageResponse.data.images || imageResponse.data.images.length === 0) {
        throw new Error('No image generated');
      }

      const avatarData = imageResponse.data.images[0];

      // Update personality with generated avatar
      await query(
        'UPDATE personalities SET avatar_data = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
        [avatarData, req.params.id, req.user.id]
      );

      res.json({
        message: 'Avatar generated successfully',
        avatarData,
        prompt: avatarPrompt
      });

    } catch (imageError) {
      console.error('Avatar generation error:', imageError);
      
      if (imageError.code === 'ECONNREFUSED' || imageError.code === 'ENOTFOUND') {
        return res.status(503).json({
          error: 'Image generation service unavailable',
          message: 'The image generation service is currently unavailable. Please try again later.'
        });
      }

      return res.status(500).json({
        error: 'Avatar generation failed',
        message: 'Failed to generate avatar image. Please try again.'
      });
    }

  } catch (error) {
    console.error('Generate avatar error:', error);
    res.status(500).json({
      error: 'Failed to generate avatar',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Update personality avatar
 */
router.put('/:id/avatar', idValidation, [
  body('avatarData')
    .isBase64()
    .withMessage('Avatar data must be a valid base64 string'),
  body('avatarPrompt')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Avatar prompt must be 1000 characters or less')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { avatarData, avatarPrompt } = req.body;

    // Check if personality exists and belongs to user
    const existingResult = await query(
      'SELECT id FROM personalities WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Personality not found',
        message: 'The requested personality does not exist or you do not have access to it'
      });
    }

    // Update avatar
    await query(
      `UPDATE personalities SET 
        avatar_data = $1, 
        avatar_prompt = COALESCE($2, avatar_prompt),
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $3 AND user_id = $4`,
      [avatarData, avatarPrompt, req.params.id, req.user.id]
    );

    res.json({
      message: 'Avatar updated successfully'
    });

  } catch (error) {
    console.error('Update avatar error:', error);
    res.status(500).json({
      error: 'Failed to update avatar',
      message: 'An internal server error occurred'
    });
  }
});

module.exports = router;