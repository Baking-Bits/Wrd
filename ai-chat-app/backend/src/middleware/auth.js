const jwt = require('jsonwebtoken');
const config = require('../config');
const { getRedisClient } = require('../database/redis');

/**
 * JWT Authentication middleware
 */
const authenticateToken = async (req, res, next) => {
  try {
    // Get token from Authorization header or cookies
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.split(' ')[1] 
      : req.cookies?.token;

    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'No token provided' 
      });
    }

    // Check if token is blacklisted
    const redis = getRedisClient();
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return res.status(401).json({ 
        error: 'Token invalid',
        message: 'Token has been revoked' 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Add user info to request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      isActive: decoded.isActive
    };
    
    req.token = token;
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        error: 'Token invalid',
        message: 'Invalid token format' 
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'Token expired',
        message: 'Token has expired' 
      });
    }

    console.error('Authentication error:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      message: 'Internal server error' 
    });
  }
};

/**
 * Optional authentication - sets user if token is valid but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.split(' ')[1] 
      : req.cookies?.token;

    if (!token) {
      return next(); // No token, continue without user
    }

    // Check if token is blacklisted
    const redis = getRedisClient();
    const isBlacklisted = await redis.get(`blacklist:${token}`);
    
    if (isBlacklisted) {
      return next(); // Blacklisted token, continue without user
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      isActive: decoded.isActive
    };
    
    req.token = token;

  } catch (error) {
    // Token verification failed, continue without user
    console.warn('Optional auth failed:', error.message);
  }
  
  next();
};

/**
 * Admin role middleware
 */
const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Authentication required' 
    });
  }

  // Check if user is admin (you can implement admin role logic here)
  if (req.user.email !== config.admin.email) {
    return res.status(403).json({ 
      error: 'Admin access required' 
    });
  }

  next();
};

/**
 * Check if user is active
 */
const requireActiveUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      error: 'Authentication required' 
    });
  }

  if (!req.user.isActive) {
    return res.status(403).json({ 
      error: 'Account deactivated',
      message: 'Your account has been deactivated. Please contact support.' 
    });
  }

  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
  requireActiveUser
};