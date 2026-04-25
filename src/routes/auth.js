const express = require('express');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const AuthService = require('../services/AuthService');
const { authenticateToken, verifyRefreshToken, requireActiveUser, rateLimitSensitive, validateOrigin } = require('../middleware/auth');
const router = express.Router();

// Rate limiting for auth endpoints
const authRateLimit = rateLimitSensitive(5, 15 * 60 * 1000); // 5 attempts per 15 minutes

// Register user
router.post('/register', authRateLimit, validateOrigin, async (req, res) => {
  try {
    const { username, email, password, confirmPassword } = req.body;

    // Validation
    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ 
        message: 'All fields are required',
        code: 'FIELDS_MISSING'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        message: 'Passwords do not match',
        code: 'PASSWORDS_MISMATCH'
      });
    }

    if (username.length < 3) {
      return res.status(400).json({ 
        message: 'Username must be at least 3 characters',
        code: 'USERNAME_TOO_SHORT'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        message: 'Password must be at least 6 characters',
        code: 'PASSWORD_TOO_SHORT'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(400).json({ 
          message: 'Username already exists',
          code: 'USERNAME_EXISTS'
        });
      }
      if (existingUser.email === email) {
        return res.status(400).json({ 
          message: 'Email already exists',
          code: 'EMAIL_EXISTS'
        });
      }
    }

    // Create new user
    const user = new User({
      username,
      email,
      password
    });

    await user.save();

    res.status(201).json({
      message: 'User registered successfully',
      code: 'REGISTRATION_SUCCESS'
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ 
      message: 'Server error during registration',
      code: 'REGISTRATION_ERROR'
    });
  }
});

// Login user
router.post('/login', authRateLimit, validateOrigin, async (req, res) => {
  try {
    const { username, password } = req.body;
    const deviceInfo = {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    };

    // Validation
    if (!username || !password) {
      return res.status(400).json({ 
        message: 'Username and password are required',
        code: 'CREDENTIALS_MISSING'
      });
    }

    // Find user by username or email
    console.log('Login attempt for username/email:', username);
    const user = await User.findOne({ 
      $or: [
        { username: username },
        { email: username }
      ]
    });
    if (!user) {
      console.log('User not found:', username);
      return res.status(401).json({ 
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }
    console.log('User found:', user.username);

    // Compare password
    console.log('Comparing password...');
    console.log('Input password:', password);
    console.log('Stored hash:', user.password);
    const isMatch = await AuthService.comparePassword(password, user.password);
    console.log('Password match result:', isMatch);
    if (!isMatch) {
      console.log('Password mismatch for user:', username);
      // Let's try a direct bcrypt comparison for debugging
      const bcrypt = require('bcryptjs');
      const directMatch = await bcrypt.compare(password, user.password);
      console.log('Direct bcrypt comparison result:', directMatch);
      return res.status(401).json({ 
        message: 'Invalid credentials',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token pair
    const tokens = await AuthService.generateTokens({
      _id: user._id,
      username: user.username,
      email: user.email
    }, deviceInfo);

    // Set refresh token in HTTPOnly cookie
    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: tokens.refreshTokenExpiresIn,
      path: '/'
    });

    res.json({
      accessToken: tokens.accessToken,
      accessTokenExpiresIn: tokens.accessTokenExpiresIn,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        lastLogin: user.lastLogin
      },
      message: 'Login successful',
      code: 'LOGIN_SUCCESS'
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      message: 'Server error during login',
      code: 'LOGIN_ERROR'
    });
  }
});

// Refresh access token
router.post('/refresh', verifyRefreshToken, validateOrigin, async (req, res) => {
  try {
    const { refreshToken } = req;
    const deviceInfo = {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress,
      timestamp: new Date().toISOString()
    };

    // Generate new token pair
    const newTokens = await AuthService.refreshAccessToken(refreshToken, deviceInfo);

    if (!newTokens) {
      return res.status(401).json({ 
        message: 'Invalid or expired refresh token',
        code: 'REFRESH_TOKEN_INVALID'
      });
    }

    // Set new refresh token in HTTPOnly cookie
    res.cookie('refreshToken', newTokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: newTokens.refreshTokenExpiresIn,
      path: '/'
    });

    res.json({
      accessToken: newTokens.accessToken,
      accessTokenExpiresIn: newTokens.accessTokenExpiresIn,
      message: 'Token refreshed successfully',
      code: 'TOKEN_REFRESH_SUCCESS'
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ 
      message: 'Server error during token refresh',
      code: 'TOKEN_REFRESH_ERROR'
    });
  }
});

// Logout (revoke current refresh token)
router.post('/logout', authenticateToken, validateOrigin, async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      await AuthService.revokeRefreshToken(refreshToken);
    }

    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });

    res.json({
      message: 'Logout successful',
      code: 'LOGOUT_SUCCESS'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      message: 'Server error during logout',
      code: 'LOGOUT_ERROR'
    });
  }
});

// Logout from all devices (revoke all user tokens)
router.post('/logout-all', authenticateToken, requireActiveUser, validateOrigin, async (req, res) => {
  try {
    await AuthService.revokeAllUserTokens(req.userId);

    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });

    res.json({
      message: 'Logged out from all devices',
      code: 'LOGOUT_ALL_SUCCESS'
    });

  } catch (error) {
    console.error('Logout all error:', error);
    res.status(500).json({ 
      message: 'Server error during logout all',
      code: 'LOGOUT_ALL_ERROR'
    });
  }
});

// Get current user info
router.get('/me', authenticateToken, requireActiveUser, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password -privateKey');
    
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    res.json({
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        publicKey: user.publicKey,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      },
      code: 'USER_INFO_SUCCESS'
    });

  } catch (error) {
    console.error('Get user info error:', error);
    res.status(500).json({ 
      message: 'Server error retrieving user info',
      code: 'USER_INFO_ERROR'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, requireActiveUser, validateOrigin, async (req, res) => {
  try {
    const { username, email, publicKey } = req.body;
    const userId = req.userId;

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Update allowed fields
    if (username && username !== user.username) {
      // Check if username is already taken
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ 
          message: 'Username already exists',
          code: 'USERNAME_EXISTS'
        });
      }
      user.username = username;
    }

    if (email && email !== user.email) {
      // Check if email is already taken
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ 
          message: 'Email already exists',
          code: 'EMAIL_EXISTS'
        });
      }
      user.email = email;
    }

    if (publicKey) {
      user.publicKey = publicKey;
    }

    await user.save();

    res.json({
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        publicKey: user.publicKey,
        lastLogin: user.lastLogin
      },
      message: 'Profile updated successfully',
      code: 'PROFILE_UPDATE_SUCCESS'
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ 
      message: 'Server error during profile update',
      code: 'PROFILE_UPDATE_ERROR'
    });
  }
});

// Change password
router.put('/password', authenticateToken, requireActiveUser, authRateLimit, validateOrigin, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.userId;

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        message: 'All password fields are required',
        code: 'PASSWORD_FIELDS_MISSING'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        message: 'New passwords do not match',
        code: 'NEW_PASSWORDS_MISMATCH'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'New password must be at least 6 characters',
        code: 'NEW_PASSWORD_TOO_SHORT'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        message: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    // Verify current password
    const isMatch = await AuthService.comparePassword(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ 
        message: 'Current password is incorrect',
        code: 'CURRENT_PASSWORD_INCORRECT'
      });
    }

    // Hash new password
    user.password = newPassword;
    await user.save();

    // Revoke all refresh tokens for security
    await AuthService.revokeAllUserTokens(userId);

    // Clear refresh token cookie
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/'
    });

    res.json({
      message: 'Password changed successfully. Please login again.',
      code: 'PASSWORD_CHANGE_SUCCESS'
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({ 
      message: 'Server error during password change',
      code: 'PASSWORD_CHANGE_ERROR'
    });
  }
});

module.exports = router;
