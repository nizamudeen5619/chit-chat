const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');
const User = require('../models/User');

class AuthService {
  constructor() {
    this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || this.generateSecret();
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || this.generateSecret();
    this.accessTokenExpiry = process.env.ACCESS_TOKEN_EXPIRY || '15m';
    this.refreshTokenExpiry = process.env.REFRESH_TOKEN_EXPIRY || '7d';
    this.bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS) || 10;
  }

  generateSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  async generateTokens(payload, deviceInfo = {}) {
    try {
      const userId = payload._id || payload.userId;
      const username = payload.username;
      const email = payload.email;

      // Generate access token (short-lived)
      const accessTokenPayload = {
        userId,
        username,
        email,
        type: 'access',
        iat: Math.floor(Date.now() / 1000)
      };

      const accessToken = jwt.sign(accessTokenPayload, this.accessTokenSecret, {
        expiresIn: this.accessTokenExpiry,
        issuer: 'chit-chat',
        audience: 'chit-chat-users'
      });

      // Generate refresh token (long-lived)
      const tokenId = crypto.randomBytes(16).toString('hex');
      const refreshTokenPayload = {
        userId,
        tokenId,
        type: 'refresh',
        iat: Math.floor(Date.now() / 1000)
      };

      const refreshToken = jwt.sign(refreshTokenPayload, this.refreshTokenSecret, {
        expiresIn: this.refreshTokenExpiry,
        issuer: 'chit-chat',
        audience: 'chit-chat-users'
      });

      // Store refresh token in database
      const expiresAt = new Date(Date.now() + this.parseExpiry(this.refreshTokenExpiry));
      await RefreshToken.create({
        userId,
        token: refreshToken,
        tokenId,
        expiresAt,
        deviceInfo: JSON.stringify(deviceInfo),
        ipAddress: deviceInfo.ipAddress || 'unknown'
      });

      return {
        accessToken,
        refreshToken,
        accessTokenExpiresIn: this.parseExpiry(this.accessTokenExpiry) * 1000,
        refreshTokenExpiresIn: this.parseExpiry(this.refreshTokenExpiry) * 1000
      };
    } catch (error) {
      console.error('Error generating tokens:', error);
      throw new Error('Token generation failed');
    }
  }

  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        issuer: 'chit-chat',
        audience: 'chit-chat-users'
      });

      if (decoded.type !== 'access') {
        return null;
      }

      return decoded;
    } catch (error) {
      console.error('Access token verification failed:', error.message);
      return null;
    }
  }

  async refreshAccessToken(refreshToken, deviceInfo = {}) {
    try {
      // Verify refresh token
      const decoded = jwt.verify(refreshToken, this.refreshTokenSecret, {
        issuer: 'chit-chat',
        audience: 'chit-chat-users'
      });

      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      // Check if token exists in database and is not revoked
      const storedToken = await RefreshToken.findOne({
        tokenId: decoded.tokenId,
        isRevoked: false
      });

      if (!storedToken) {
        throw new Error('Token not found or revoked');
      }

      // Check if token hasn't expired
      if (storedToken.expiresAt < new Date()) {
        throw new Error('Token expired');
      }

      // Fetch user data
      const user = await User.findById(decoded.userId);
      if (!user || !user.isActive) {
        throw new Error('User not found or inactive');
      }

      // Revoke OLD refresh token (token rotation for security)
      await RefreshToken.updateOne(
        { tokenId: decoded.tokenId },
        { isRevoked: true }
      );

      // Generate NEW token pair
      const newTokens = await this.generateTokens({
        _id: user._id,
        username: user.username,
        email: user.email
      }, deviceInfo);

      return newTokens;
    } catch (error) {
      console.error('Token refresh failed:', error.message);
      return null;
    }
  }

  async revokeRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.refreshTokenSecret);
      
      if (decoded.type === 'refresh') {
        await RefreshToken.updateOne(
          { tokenId: decoded.tokenId },
          { isRevoked: true }
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error('Token revocation failed:', error.message);
      return false;
    }
  }

  async revokeAllUserTokens(userId) {
    try {
      await RefreshToken.updateMany(
        { userId },
        { isRevoked: true }
      );
      return true;
    } catch (error) {
      console.error('Revoking all user tokens failed:', error.message);
      return false;
    }
  }

  async hashPassword(password) {
    try {
      const salt = await bcrypt.genSalt(this.bcryptRounds);
      const hashedPassword = await bcrypt.hash(password, salt);
      return hashedPassword;
    } catch (error) {
      console.error('Password hashing failed:', error);
      throw new Error('Password hashing failed');
    }
  }

  async comparePassword(password, hash) {
    try {
      const isMatch = await bcrypt.compare(password, hash);
      return isMatch;
    } catch (error) {
      console.error('Password comparison failed:', error);
      return false;
    }
  }

  async cleanExpiredTokens() {
    try {
      const result = await RefreshToken.deleteMany({
        $or: [
          { expiresAt: { $lt: new Date() } },
          { isRevoked: true }
        ]
      });
      console.log(`Cleaned up ${result.deletedCount} expired/revoked tokens`);
      return result.deletedCount;
    } catch (error) {
      console.error('Token cleanup failed:', error.message);
      return 0;
    }
  }

  parseExpiry(expiryString) {
    // Parse expiry strings like '15m', '7d', '1h' into seconds
    const unit = expiryString.slice(-1);
    const value = parseInt(expiryString.slice(0, -1));
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 24 * 60 * 60;
      default: return value;
    }
  }

  // Extract token from Authorization header
  extractTokenFromHeader(authHeader) {
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    return null;
  }

  // Generate secure random string for various purposes
  generateSecureRandom(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }
}

module.exports = new AuthService();
