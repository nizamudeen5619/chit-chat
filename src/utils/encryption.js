const nacl = require('tweetnacl');
const util = require('tweetnacl-util');

class EncryptionManager {
    constructor() {
        this.keyPair = nacl.box.keyPair();
        this.roomKeys = new Map(); // room -> shared secret key
        this.userPublicKeys = new Map(); // username -> public key
    }

    // Get current user's public key (base64 encoded)
    getPublicKey() {
        return util.encodeBase64(this.keyPair.publicKey);
    }

    // Get current user's private key (base64 encoded)
    getPrivateKey() {
        return util.encodeBase64(this.keyPair.secretKey);
    }

    // Store another user's public key
    storeUserPublicKey(username, publicKey) {
        this.userPublicKeys.set(username, publicKey);
    }

    // Generate a shared secret for a room
    generateRoomKey() {
        return util.encodeBase64(nacl.randomBytes(32));
    }

    // Store room key
    storeRoomKey(room, key) {
        this.roomKeys.set(room, key);
    }

    // Get room key
    getRoomKey(room) {
        return this.roomKeys.get(room);
    }

    // Encrypt message for a room
    encryptMessage(message, room) {
        const roomKey = this.getRoomKey(room);
        if (!roomKey) {
            throw new Error('No encryption key found for room');
        }

        const key = util.decodeBase64(roomKey);
        const nonce = nacl.randomBytes(24);
        const messageUint8 = util.decodeUTF8(message);
        const encrypted = nacl.secretbox(messageUint8, nonce, key);

        if (!encrypted) {
            throw new Error('Encryption failed');
        }

        return {
            encrypted: util.encodeBase64(encrypted),
            nonce: util.encodeBase64(nonce)
        };
    }

    // Decrypt message from a room
    decryptMessage(encryptedData, room) {
        const roomKey = this.getRoomKey(room);
        if (!roomKey) {
            throw new Error('No decryption key found for room');
        }

        const key = util.decodeBase64(roomKey);
        const encrypted = util.decodeBase64(encryptedData.encrypted);
        const nonce = util.decodeBase64(encryptedData.nonce);

        const decrypted = nacl.secretbox.open(encrypted, nonce, key);

        if (!decrypted) {
            throw new Error('Decryption failed');
        }

        return util.encodeUTF8(decrypted);
    }

    // Encrypt room key for a specific user (for key exchange)
    encryptRoomKeyForUser(roomKey, userPublicKey) {
        const nonce = nacl.randomBytes(24);
        const keyUint8 = util.decodeBase64(roomKey);
        const publicKey = util.decodeBase64(userPublicKey);
        
        const encrypted = nacl.box(keyUint8, nonce, publicKey, this.keyPair.secretKey);
        
        if (!encrypted) {
            throw new Error('Key encryption failed');
        }

        return {
            encrypted: util.encodeBase64(encrypted),
            nonce: util.encodeBase64(nonce),
            senderPublicKey: this.getPublicKey()
        };
    }

    // Decrypt room key from another user
    decryptRoomKeyFromUser(encryptedKeyData, senderPublicKey) {
        const encrypted = util.decodeBase64(encryptedKeyData.encrypted);
        const nonce = util.decodeBase64(encryptedKeyData.nonce);
        const publicKey = util.decodeBase64(senderPublicKey);

        const decrypted = nacl.box.open(encrypted, nonce, publicKey, this.keyPair.secretKey);

        if (!decrypted) {
            throw new Error('Key decryption failed');
        }

        return util.encodeBase64(decrypted);
    }
}

module.exports = EncryptionManager;
