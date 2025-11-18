const express = require('express');
const { body, validationResult } = require('express-validator');
const config = require('../config');
const { query } = require('../database/postgres');
const { authenticateToken, requireActiveUser } = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

// Apply authentication to all AI proxy routes
router.use(authenticateToken, requireActiveUser);

/**
 * Get user's AI service URLs from settings
 */
const getUserAIUrls = async (userId) => {
  try {
    const result = await query(
      'SELECT localai_url, a1111_url, comfyui_url FROM user_settings WHERE user_id = $1',
      [userId]
    );

    const settings = result.rows[0] || {};
    
    return {
      localai: settings.localai_url || config.aiServices.localai.url,
      automatic1111: settings.a1111_url || config.aiServices.automatic1111.url,
      comfyui: settings.comfyui_url || config.aiServices.comfyui.url
    };
  } catch (error) {
    console.error('Error fetching user AI URLs:', error);
    return {
      localai: config.aiServices.localai.url,
      automatic1111: config.aiServices.automatic1111.url,
      comfyui: config.aiServices.comfyui.url
    };
  }
};

/**
 * Proxy request to AI service with error handling
 */
const proxyToAI = async (targetUrl, requestData, headers = {}, timeout = 30000) => {
  try {
    const response = await axios.post(targetUrl, requestData, {
      timeout,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });

    return {
      success: true,
      data: response.data,
      status: response.status
    };
  } catch (error) {
    console.error('AI proxy error:', error.message);
    
    let errorMessage = 'AI service request failed';
    let statusCode = 500;

    if (error.code === 'ECONNREFUSED') {
      errorMessage = 'AI service is not responding - check if the service is running';
      statusCode = 503;
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'AI service request timed out - the service may be overloaded';
      statusCode = 504;
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'AI service not found - check the service URL in settings';
      statusCode = 503;
    } else if (error.response) {
      errorMessage = error.response.data?.error || 'AI service returned an error';
      statusCode = error.response.status;
    }

    return {
      success: false,
      error: errorMessage,
      statusCode,
      details: error.message
    };
  }
};

/**
 * LocalAI Chat Completions
 */
router.post('/localai/chat/completions', [
  body('messages')
    .isArray({ min: 1 })
    .withMessage('Messages must be an array with at least one message'),
  body('messages.*.role')
    .isIn(['system', 'user', 'assistant'])
    .withMessage('Message role must be system, user, or assistant'),
  body('messages.*.content')
    .isString()
    .isLength({ min: 1, max: 10000 })
    .withMessage('Message content must be between 1 and 10000 characters'),
  body('model')
    .optional()
    .isString()
    .withMessage('Model must be a string'),
  body('max_tokens')
    .optional()
    .isInt({ min: 1, max: 4096 })
    .withMessage('Max tokens must be between 1 and 4096'),
  body('temperature')
    .optional()
    .isFloat({ min: 0, max: 2 })
    .withMessage('Temperature must be between 0 and 2'),
  body('stream')
    .optional()
    .isBoolean()
    .withMessage('Stream must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.localai}/v1/chat/completions`;

    const requestData = {
      model: req.body.model || 'gpt-4',
      messages: req.body.messages,
      max_tokens: req.body.max_tokens || 2048,
      temperature: req.body.temperature || 0.7,
      stream: req.body.stream || false
    };

    const result = await proxyToAI(
      targetUrl, 
      requestData, 
      { 'Authorization': 'Bearer dummy-token' },
      config.aiServices.localai.timeout
    );

    if (result.success) {
      res.status(result.status).json(result.data);
    } else {
      res.status(result.statusCode).json({
        error: result.error,
        details: result.details
      });
    }

  } catch (error) {
    console.error('LocalAI proxy error:', error);
    res.status(500).json({
      error: 'LocalAI proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * LocalAI Models List
 */
router.get('/localai/models', async (req, res) => {
  try {
    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.localai}/v1/models`;

    try {
      const response = await axios.get(targetUrl, {
        timeout: 10000,
        headers: {
          'Authorization': 'Bearer dummy-token'
        }
      });

      res.json(response.data);
    } catch (error) {
      console.error('LocalAI models error:', error);
      res.status(503).json({
        error: 'Failed to fetch models',
        message: 'LocalAI service is not available'
      });
    }

  } catch (error) {
    console.error('LocalAI models proxy error:', error);
    res.status(500).json({
      error: 'Models proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Automatic1111 Text-to-Image
 */
router.post('/automatic1111/txt2img', [
  body('prompt')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Prompt must be between 1 and 2000 characters'),
  body('negative_prompt')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Negative prompt must be 1000 characters or less'),
  body('width')
    .optional()
    .isInt({ min: 64, max: 2048 })
    .withMessage('Width must be between 64 and 2048'),
  body('height')
    .optional()
    .isInt({ min: 64, max: 2048 })
    .withMessage('Height must be between 64 and 2048'),
  body('steps')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Steps must be between 1 and 100'),
  body('cfg_scale')
    .optional()
    .isFloat({ min: 1, max: 30 })
    .withMessage('CFG scale must be between 1 and 30'),
  body('batch_size')
    .optional()
    .isInt({ min: 1, max: 4 })
    .withMessage('Batch size must be between 1 and 4')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.automatic1111}/sdapi/v1/txt2img`;

    const requestData = {
      prompt: req.body.prompt,
      negative_prompt: req.body.negative_prompt || 'blurry, low quality, distorted',
      width: req.body.width || 512,
      height: req.body.height || 512,
      steps: req.body.steps || 20,
      cfg_scale: req.body.cfg_scale || 7,
      sampler_name: req.body.sampler_name || 'DPM++ 2M Karras',
      batch_size: req.body.batch_size || 1,
      n_iter: req.body.n_iter || 1
    };

    const result = await proxyToAI(
      targetUrl,
      requestData,
      {},
      config.aiServices.automatic1111.timeout
    );

    if (result.success) {
      res.status(result.status).json(result.data);
    } else {
      res.status(result.statusCode).json({
        error: result.error,
        details: result.details
      });
    }

  } catch (error) {
    console.error('Automatic1111 proxy error:', error);
    res.status(500).json({
      error: 'Automatic1111 proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Automatic1111 Image-to-Image
 */
router.post('/automatic1111/img2img', [
  body('init_images')
    .isArray({ min: 1, max: 1 })
    .withMessage('Init images must be an array with exactly one base64 image'),
  body('prompt')
    .isString()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Prompt must be between 1 and 2000 characters'),
  body('denoising_strength')
    .optional()
    .isFloat({ min: 0, max: 1 })
    .withMessage('Denoising strength must be between 0 and 1')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.automatic1111}/sdapi/v1/img2img`;

    const requestData = {
      init_images: req.body.init_images,
      prompt: req.body.prompt,
      negative_prompt: req.body.negative_prompt || 'blurry, low quality, distorted',
      width: req.body.width || 512,
      height: req.body.height || 512,
      steps: req.body.steps || 20,
      cfg_scale: req.body.cfg_scale || 7,
      denoising_strength: req.body.denoising_strength || 0.7,
      sampler_name: req.body.sampler_name || 'DPM++ 2M Karras',
      batch_size: req.body.batch_size || 1
    };

    const result = await proxyToAI(
      targetUrl,
      requestData,
      {},
      config.aiServices.automatic1111.timeout
    );

    if (result.success) {
      res.status(result.status).json(result.data);
    } else {
      res.status(result.statusCode).json({
        error: result.error,
        details: result.details
      });
    }

  } catch (error) {
    console.error('Automatic1111 img2img proxy error:', error);
    res.status(500).json({
      error: 'Automatic1111 img2img proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * Automatic1111 Get Samplers
 */
router.get('/automatic1111/samplers', async (req, res) => {
  try {
    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.automatic1111}/sdapi/v1/samplers`;

    try {
      const response = await axios.get(targetUrl, {
        timeout: 10000
      });

      res.json(response.data);
    } catch (error) {
      console.error('Automatic1111 samplers error:', error);
      res.status(503).json({
        error: 'Failed to fetch samplers',
        message: 'Automatic1111 service is not available'
      });
    }

  } catch (error) {
    console.error('Automatic1111 samplers proxy error:', error);
    res.status(500).json({
      error: 'Samplers proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * ComfyUI Queue Prompt
 */
router.post('/comfyui/prompt', [
  body('prompt')
    .isObject()
    .withMessage('Prompt must be a valid ComfyUI workflow object'),
  body('client_id')
    .optional()
    .isString()
    .withMessage('Client ID must be a string')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.comfyui}/prompt`;

    const requestData = {
      prompt: req.body.prompt,
      client_id: req.body.client_id || `user-${req.user.id}-${Date.now()}`
    };

    const result = await proxyToAI(
      targetUrl,
      requestData,
      {},
      config.aiServices.comfyui.timeout
    );

    if (result.success) {
      res.status(result.status).json(result.data);
    } else {
      res.status(result.statusCode).json({
        error: result.error,
        details: result.details
      });
    }

  } catch (error) {
    console.error('ComfyUI proxy error:', error);
    res.status(500).json({
      error: 'ComfyUI proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * ComfyUI Queue Status
 */
router.get('/comfyui/queue', async (req, res) => {
  try {
    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.comfyui}/queue`;

    try {
      const response = await axios.get(targetUrl, {
        timeout: 10000
      });

      res.json(response.data);
    } catch (error) {
      console.error('ComfyUI queue error:', error);
      res.status(503).json({
        error: 'Failed to fetch queue status',
        message: 'ComfyUI service is not available'
      });
    }

  } catch (error) {
    console.error('ComfyUI queue proxy error:', error);
    res.status(500).json({
      error: 'Queue proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

/**
 * ComfyUI System Stats
 */
router.get('/comfyui/system_stats', async (req, res) => {
  try {
    const urls = await getUserAIUrls(req.user.id);
    const targetUrl = `${urls.comfyui}/system_stats`;

    try {
      const response = await axios.get(targetUrl, {
        timeout: 10000
      });

      res.json(response.data);
    } catch (error) {
      console.error('ComfyUI system stats error:', error);
      res.status(503).json({
        error: 'Failed to fetch system stats',
        message: 'ComfyUI service is not available'
      });
    }

  } catch (error) {
    console.error('ComfyUI system stats proxy error:', error);
    res.status(500).json({
      error: 'System stats proxy failed',
      message: 'An internal server error occurred'
    });
  }
});

module.exports = router;