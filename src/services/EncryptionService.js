const crypto = require('crypto');
const algorithm = 'aes-256-gcm';

class EncryptionService {
  constructor() {
    this.keyLength = 32; // 256 bits
    this.ivLength = 16; // 128 bits
    this.authTagLength = 16; // 128 bits
    this.masterEncryptionKey = process.env.MASTER_ENCRYPTION_KEY || this.generateKey();
    this.databaseEncryptionKey = process.env.DATABASE_ENCRYPTION_KEY || this.generateKey();
  }

  generateKey() {
    return crypto.randomBytes(this.keyLength).toString('hex');
  }

  // Layer 3: Server-side encryption for database storage
  encryptForDatabase(data) {
    try {
      // Convert data to string if it's an object
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      
      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);
      
      // Create cipher with IV
      const cipher = crypto.createCipheriv(algorithm, Buffer.from(this.databaseEncryptionKey, 'hex'), iv);
      cipher.setAAD(Buffer.from('chit-chat-db', 'utf8')); // Additional authenticated data
      
      // Encrypt the data
      let encrypted = cipher.update(dataString, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      // Get authentication tag
      const authTag = cipher.getAuthTag();
      
      return {
        encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        algorithm: 'aes-256-gcm'
      };
    } catch (error) {
      console.error('Database encryption failed:', error);
      throw new Error('Database encryption failed');
    }
  }

  decryptFromDatabase(encryptedData) {
    try {
      if (!encryptedData || !encryptedData.encrypted || !encryptedData.iv || !encryptedData.authTag) {
        throw new Error('Invalid encrypted data format');
      }

      // Create decipher with IV
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const decipher = crypto.createDecipheriv(algorithm, Buffer.from(this.databaseEncryptionKey, 'hex'), iv);
      decipher.setAAD(Buffer.from('chit-chat-db', 'utf8'));
      
      // Set authentication tag
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      decipher.setAuthTag(authTag);
      
      // Decrypt the data
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      // Try to parse as JSON, if fails return as string
      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
    } catch (error) {
      console.error('Database decryption failed:', error);
      throw new Error('Database decryption failed');
    }
  }

  // Verify client-side encryption structure
  verifyClientEncryption(data) {
    if (!data || typeof data !== 'object') {
      return false;
    }
    
    return (
      data.hasOwnProperty('encrypted') &&
      data.hasOwnProperty('nonce') &&
      typeof data.encrypted === 'string' &&
      typeof data.nonce === 'string'
    );
  }

  // One-way hash using SHA-256
  hashData(data) {
    try {
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      return crypto.createHash('sha256').update(dataString).digest('hex');
    } catch (error) {
      console.error('Data hashing failed:', error);
      throw new Error('Data hashing failed');
    }
  }

  // Generate RSA key pair for user
  generateKeyPair() {
    try {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });

      return {
        publicKey: publicKey.toString('base64'),
        privateKey: privateKey.toString('base64')
      };
    } catch (error) {
      console.error('Key pair generation failed:', error);
      throw new Error('Key pair generation failed');
    }
  }

  // Encrypt data using RSA public key
  encryptWithPublicKey(data, publicKey) {
    try {
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      const publicKeyBuffer = Buffer.from(publicKey, 'base64');
      
      const encrypted = crypto.publicEncrypt(
        {
          key: publicKeyBuffer,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        Buffer.from(dataString, 'utf8')
      );
      
      return encrypted.toString('base64');
    } catch (error) {
      console.error('Public key encryption failed:', error);
      throw new Error('Public key encryption failed');
    }
  }

  // Decrypt data using RSA private key
  decryptWithPrivateKey(encryptedData, privateKey) {
    try {
      const privateKeyBuffer = Buffer.from(privateKey, 'base64');
      const encryptedBuffer = Buffer.from(encryptedData, 'base64');
      
      const decrypted = crypto.privateDecrypt(
        {
          key: privateKeyBuffer,
          padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256'
        },
        encryptedBuffer
      );
      
      const decryptedString = decrypted.toString('utf8');
      
      // Try to parse as JSON, if fails return as string
      try {
        return JSON.parse(decryptedString);
      } catch {
        return decryptedString;
      }
    } catch (error) {
      console.error('Private key decryption failed:', error);
      throw new Error('Private key decryption failed');
    }
  }

  // Generate secure random string for various purposes
  generateSecureRandom(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  // Create HMAC for message integrity
  createHMAC(data, secret) {
    try {
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      return crypto.createHmac('sha256', secret).update(dataString).digest('hex');
    } catch (error) {
      console.error('HMAC creation failed:', error);
      throw new Error('HMAC creation failed');
    }
  }

  // Verify HMAC for message integrity
  verifyHMAC(data, hmac, secret) {
    try {
      const computedHMAC = this.createHMAC(data, secret);
      return crypto.timingSafeEqual(
        Buffer.from(hmac, 'hex'),
        Buffer.from(computedHMAC, 'hex')
      );
    } catch (error) {
      console.error('HMAC verification failed:', error);
      return false;
    }
  }

  // Derive key from password using PBKDF2
  deriveKey(password, salt, iterations = 100000) {
    try {
      return crypto.pbkdf2Sync(password, salt, iterations, this.keyLength, 'sha256');
    } catch (error) {
      console.error('Key derivation failed:', error);
      throw new Error('Key derivation failed');
    }
  }

  // Generate room key for client-side encryption
  generateRoomKey() {
    try {
      return crypto.randomBytes(32); // 256-bit key for NaCl
    } catch (error) {
      console.error('Room key generation failed:', error);
      throw new Error('Room key generation failed');
    }
  }

  // Encrypt room key for sharing between users
  encryptRoomKey(roomKey, recipientPublicKey) {
    try {
      // Convert room key to base64 for transport
      const roomKeyBase64 = Buffer.from(roomKey).toString('base64');
      return this.encryptWithPublicKey(roomKeyBase64, recipientPublicKey);
    } catch (error) {
      console.error('Room key encryption failed:', error);
      throw new Error('Room key encryption failed');
    }
  }

  // Decrypt room key received from another user
  decryptRoomKey(encryptedRoomKey, senderPublicKey, privateKey) {
    try {
      const decryptedRoomKeyBase64 = this.decryptWithPrivateKey(encryptedRoomKey, privateKey);
      return Buffer.from(decryptedRoomKeyBase64, 'base64');
    } catch (error) {
      console.error('Room key decryption failed:', error);
      throw new Error('Room key decryption failed');
    }
  }

  // Validate encryption key format
  validateKey(key, expectedLength = this.keyLength) {
    try {
      const keyBuffer = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex');
      return keyBuffer.length === expectedLength;
    } catch (error) {
      console.error('Key validation failed:', error);
      return false;
    }
  }

  // Secure compare to prevent timing attacks
  secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return false;
    }
    
    if (a.length !== b.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}

module.exports = new EncryptionService();
