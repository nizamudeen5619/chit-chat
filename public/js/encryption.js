class ClientEncryption {
    constructor() {
        this.keyPair = nacl.box.keyPair();
        this.roomKeys = new Map(); // room -> shared secret key
        this.userPublicKeys = new Map(); // username -> public key
    }

    // Get current user's public key (base64 encoded)
    getPublicKey() {
        return nacl.util.encodeBase64(this.keyPair.publicKey);
    }

    // Get current user's private key (base64 encoded)
    getPrivateKey() {
        return nacl.util.encodeBase64(this.keyPair.secretKey);
    }

    // Store another user's public key
    storeUserPublicKey(username, publicKey) {
        this.userPublicKeys.set(username, publicKey);
    }

    // Generate a shared secret for a room
    generateRoomKey() {
        return nacl.util.encodeBase64(nacl.randomBytes(32));
    }

    // Store room key
    storeRoomKey(room, key) {
        this.roomKeys.set(room, key);
        // Store in localStorage for persistence
        localStorage.setItem(`roomKey_${room}`, key);
    }

    // Get room key
    getRoomKey(room) {
        // Try memory first, then localStorage
        let key = this.roomKeys.get(room);
        if (!key) {
            key = localStorage.getItem(`roomKey_${room}`);
            if (key) {
                this.roomKeys.set(room, key);
            }
        }
        return key;
    }

    // Encrypt message for a room
    encryptMessage(message, room) {
        const roomKey = this.getRoomKey(room);
        if (!roomKey) {
            throw new Error('No encryption key found for room');
        }

        const key = nacl.util.decodeBase64(roomKey);
        const nonce = nacl.randomBytes(24);
        const messageUint8 = nacl.util.decodeUTF8(message);
        const encrypted = nacl.secretbox(messageUint8, nonce, key);

        if (!encrypted) {
            throw new Error('Encryption failed');
        }

        return {
            encrypted: nacl.util.encodeBase64(encrypted),
            nonce: nacl.util.encodeBase64(nonce)
        };
    }

    // Decrypt message from a room
    decryptMessage(encryptedData, room) {
        const roomKey = this.getRoomKey(room);
        if (!roomKey) {
            throw new Error('No decryption key found for room');
        }

        const key = nacl.util.decodeBase64(roomKey);
        const encrypted = nacl.util.decodeBase64(encryptedData.encrypted);
        const nonce = nacl.util.decodeBase64(encryptedData.nonce);

        const decrypted = nacl.secretbox.open(encrypted, nonce, key);

        if (!decrypted) {
            throw new Error('Decryption failed');
        }

        return nacl.util.encodeUTF8(decrypted);
    }

    // Encrypt room key for a specific user (for key exchange)
    encryptRoomKeyForUser(roomKey, userPublicKey) {
        const nonce = nacl.randomBytes(24);
        // Room key is stored as base64, so decode it first to get raw bytes
        const keyUint8 = nacl.util.decodeBase64(roomKey);
        const publicKey = nacl.util.decodeBase64(userPublicKey);
        
        const encrypted = nacl.box(keyUint8, nonce, publicKey, this.keyPair.secretKey);
        
        if (!encrypted) {
            throw new Error('Key encryption failed');
        }

        return {
            encrypted: nacl.util.encodeBase64(encrypted),
            nonce: nacl.util.encodeBase64(nonce)
        };
    }

    // Decrypt room key from another user
    decryptRoomKeyFromUser(encryptedKeyData, senderPublicKey) {
        const encrypted = nacl.util.decodeBase64(encryptedKeyData.encrypted);
        const nonce = nacl.util.decodeBase64(encryptedKeyData.nonce);
        const publicKey = nacl.util.decodeBase64(senderPublicKey);

        const decrypted = nacl.box.open(encrypted, nonce, publicKey, this.keyPair.secretKey);

        if (!decrypted) {
            throw new Error('Key decryption failed');
        }

        // Room keys are stored as base64, so encode the decrypted bytes as base64
        const result = nacl.util.encodeBase64(decrypted);
        return result;
    }

    // Check if message is encrypted
    isEncrypted(message) {
        return message && typeof message === 'object' && message.encrypted && message.nonce;
    }
}
