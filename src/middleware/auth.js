const AuthService = require('../services/AuthService');
const User = require('../models/User');

// Middleware to authenticate access tokens
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = AuthService.extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({ 
        message: 'Access token required',
        code: 'TOKEN_MISSING'
      });
    }

    // Verify the access token
    const decoded = AuthService.verifyAccessToken(token);
    
    if (!decoded) {
      return res.status(401).json({ 
        message: 'Invalid or expired access token',
        code: 'TOKEN_INVALID'
      });
    }

    // Attach user payload to request
    req.user = decoded;
    req.userId = decoded.userId;
    req.username = decoded.username;

    next();
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(500).json({ 
      message: 'Authentication error',
      code: 'AUTH_ERROR'
    });
  }
};

// Middleware to verify refresh tokens
const verifyRefreshToken = async (req, res, next) => {
  try {
    // Extract refresh token from cookie or request body
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ 
        message: 'Refresh token required',
        code: 'REFRESH_TOKEN_MISSING'
      });
    }

    // Basic verification of refresh token format
    const decoded = AuthService.verifyAccessToken(refreshToken);
    
    if (!decoded || decoded.type !== 'refresh') {
      return res.status(401).json({ 
        message: 'Invalid refresh token',
        code: 'REFRESH_TOKEN_INVALID'
      });
    }

    // Attach token to request for processing
    req.refreshToken = refreshToken;
    next();
  } catch (error) {
    console.error('Refresh token verification error:', error);
    return res.status(500).json({ 
      message: 'Refresh token verification error',
      code: 'REFRESH_ERROR'
    });
  }
};

// Middleware to check if user is active
const requireActiveUser = async (req, res, next) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ 
        message: 'User ID required',
        code: 'USER_ID_MISSING'
      });
    }

    const user = await User.findById(req.userId);
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ 
        message: 'User account is inactive',
        code: 'USER_INACTIVE'
      });
    }

    // Attach full user object to request
    req.fullUser = user;
    next();
  } catch (error) {
    console.error('Active user check error:', error);
    return res.status(500).json({ 
      message: 'User verification error',
      code: 'USER_VERIFICATION_ERROR'
    });
  }
};

// Middleware to check user permissions (placeholder for future role-based access)
const requirePermission = (permission) => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          message: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      // For now, all authenticated users have basic permissions
      // This can be extended for role-based access control
      const userPermissions = req.user.permissions || [];
      
      if (!userPermissions.includes(permission) && !userPermissions.includes('admin')) {
        return res.status(403).json({ 
          message: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: permission
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ 
        message: 'Permission check error',
        code: 'PERMISSION_ERROR'
      });
    }
  };
};

// Middleware to validate request origin for sensitive operations
const validateOrigin = (req, res, next) => {
  try {
    const origin = req.headers.origin;
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:4200'];
    
    if (!origin || allowedOrigins.includes(origin)) {
      next();
    } else {
      return res.status(403).json({ 
        message: 'Origin not allowed',
        code: 'ORIGIN_NOT_ALLOWED'
      });
    }
  } catch (error) {
    console.error('Origin validation error:', error);
    return res.status(500).json({ 
      message: 'Origin validation error',
      code: 'ORIGIN_VALIDATION_ERROR'
    });
  }
};

// Middleware to rate limit sensitive operations
const rateLimitSensitive = (maxRequests = 5, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    try {
      const key = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Clean old entries
      for (const [ip, timestamps] of requests.entries()) {
        const validTimestamps = timestamps.filter(timestamp => timestamp > windowStart);
        if (validTimestamps.length === 0) {
          requests.delete(ip);
        } else {
          requests.set(ip, validTimestamps);
        }
      }

      // Check current requests
      const userRequests = requests.get(key) || [];
      const recentRequests = userRequests.filter(timestamp => timestamp > windowStart);

      if (recentRequests.length >= maxRequests) {
        return res.status(429).json({ 
          message: 'Too many requests. Please try again later.',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }

      // Add current request
      recentRequests.push(now);
      requests.set(key, recentRequests);

      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      next(); // Continue on error, don't block requests
    }
  };
};

// Error handling middleware for authentication errors
const handleAuthError = (error, req, res, next) => {
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({ 
      message: 'Invalid token',
      code: 'TOKEN_INVALID'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({ 
      message: 'Token expired',
      code: 'TOKEN_EXPIRED'
    });
  }

  if (error.code === 'AUTH_REQUIRED') {
    return res.status(401).json({ 
      message: error.message,
      code: 'AUTH_REQUIRED'
    });
  }

  // Pass other errors to general error handler
  next(error);
};

module.exports = {
  authenticateToken,
  verifyRefreshToken,
  requireActiveUser,
  requirePermission,
  validateOrigin,
  rateLimitSensitive,
  handleAuthError
};
