const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  tokenId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  isRevoked: {
    type: Boolean,
    default: false,
    index: true
  },
  deviceInfo: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Compound index for efficient token lookup
refreshTokenSchema.index({ token: 1, isRevoked: 1 });

// Index for user token queries
refreshTokenSchema.index({ userId: 1, isRevoked: 1 });

// TTL index for automatic cleanup of expired tokens
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to check if token is expired
refreshTokenSchema.methods.isExpired = function() {
  return this.expiresAt < new Date();
};

// Method to check if token is valid
refreshTokenSchema.methods.isValid = function() {
  return !this.isRevoked && !this.isExpired();
};

// Static method to find valid token
refreshTokenSchema.statics.findValidToken = function(tokenId) {
  return this.findOne({
    tokenId,
    isRevoked: false,
    expiresAt: { $gt: new Date() }
  });
};

// Static method to revoke all user tokens
refreshTokenSchema.statics.revokeAllUserTokens = function(userId) {
  return this.updateMany(
    { userId },
    { isRevoked: true }
  );
};

// Static method to cleanup expired and revoked tokens
refreshTokenSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { isRevoked: true }
    ]
  });
};

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = RefreshToken;
