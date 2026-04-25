const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  publicKey: {
    type: String,
    default: null
  },
  privateKey: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function() {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) {
    return;
  }

  // Hash password with bcrypt
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token (legacy method - use AuthService instead)
userSchema.methods.generateAuthToken = function() {
  const token = jwt.sign(
    { _id: this._id, username: this.username },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '7d' }
  );
  return token;
};

// Remove password and private key from JSON output
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.privateKey;
  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
