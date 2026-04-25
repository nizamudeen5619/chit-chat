const mongoose = require('mongoose');
const EncryptionService = require('../services/EncryptionService');

const messageSchema = new mongoose.Schema({
  room: {
    type: String,
    required: true,
    index: true
  },
  username: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Client-side encrypted content (Layer 1)
  encryptedContent: {
    encrypted: {
      type: String,
      required: true
    },
    nonce: {
      type: String,
      required: true
    }
  },
  // Server-side encrypted content (Layer 2)
  serverEncrypted: {
    encrypted: {
      type: String,
      required: true
    },
    iv: {
      type: String,
      required: true
    },
    authTag: {
      type: String,
      required: true
    },
    algorithm: {
      type: String,
      required: true,
      default: 'aes-256-gcm'
    }
  },
  messageType: {
    type: String,
    enum: ['text', 'location', 'file'],
    default: 'text'
  },
  // For location messages
  url: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true
});

// Compound index for efficient room queries
messageSchema.index({ room: 1, createdAt: -1 });

// Index for user message queries
messageSchema.index({ userId: 1, createdAt: -1 });

// Index for time-based queries
messageSchema.index({ createdAt: -1 });

// Pre-save middleware to encrypt client content for database storage
messageSchema.pre('save', function(next) {
  if (this.isModified('encryptedContent')) {
    try {
      // Verify client encryption structure
      if (!EncryptionService.verifyClientEncryption(this.encryptedContent)) {
        throw new Error('Invalid client encryption format');
      }

      // Encrypt the entire encryptedContent object for database storage
      this.serverEncrypted = EncryptionService.encryptForDatabase(this.encryptedContent);
    } catch (error) {
      console.error('Server encryption failed:', error);
      return next(error);
    }
  }
  next();
});

// Method to get client-encrypted content (for sending to frontend)
messageSchema.methods.getClientEncryptedContent = function() {
  try {
    if (this.serverEncrypted && this.serverEncrypted.encrypted) {
      // Decrypt server layer to get client-encrypted content
      return EncryptionService.decryptFromDatabase(this.serverEncrypted);
    }
    return this.encryptedContent;
  } catch (error) {
    console.error('Failed to get client encrypted content:', error);
    return null;
  }
};

// Method to check if message is encrypted
messageSchema.methods.isEncrypted = function() {
  return (
    this.encryptedContent &&
    this.encryptedContent.encrypted &&
    this.encryptedContent.nonce
  );
};

// Static method to create encrypted message
messageSchema.statics.createEncryptedMessage = function(messageData) {
  const { room, username, userId, encryptedContent, messageType = 'text', url = null } = messageData;

  // Verify client encryption
  if (!EncryptionService.verifyClientEncryption(encryptedContent)) {
    throw new Error('Invalid client encryption format');
  }

  return new this({
    room,
    username,
    userId,
    encryptedContent,
    messageType,
    url,
    createdAt: new Date()
  });
};

// Static method to find messages by room
messageSchema.statics.findByRoom = function(room, limit = 50, skip = 0) {
  return this.find({ room, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to find messages by user
messageSchema.statics.findByUser = function(userId, limit = 50, skip = 0) {
  return this.find({ userId, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

// Static method to soft delete message
messageSchema.statics.softDelete = function(messageId, userId) {
  return this.updateOne(
    { _id: messageId, userId },
    { isDeleted: true }
  );
};

// Static method to get message count by room
messageSchema.statics.getCountByRoom = function(room) {
  return this.countDocuments({ room, isDeleted: false });
};

// Static method to cleanup old messages
messageSchema.statics.cleanupOldMessages = function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  return this.deleteMany({
    createdAt: { $lt: cutoffDate }
  });
};

// Virtual for message age
messageSchema.virtual('age').get(function() {
  return Date.now() - this.createdAt.getTime();
});

// Ensure virtuals are included in JSON
messageSchema.set('toJSON', { virtuals: true });
messageSchema.set('toObject', { virtuals: true });

const Message = mongoose.model('Message', messageSchema);

module.exports = Message;
