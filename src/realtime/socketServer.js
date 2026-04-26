const AuthService = require('../services/AuthService');
const { generateMessage, generateLocationMessage } = require('../utils/messages');
const { addUser, removeUser, getUser, getUsersInRoom } = require('../utils/users');
const { saveMessage, getRoomMessages } = require('../utils/rooms');
const EncryptionManager = require('../utils/encryption');
const logger = require('../utils/logger');

function registerSocketHandlers(io) {
  const socketEncryption = new Map();

  io.on('connection', (socket) => {
    logger.info('socket.connected', { socketId: socket.id });

    socket.on('authenticate', async (token, callback) => {
      try {
        if (!token) throw new Error('Authentication token required');

        const decoded = AuthService.verifyAccessToken(token);
        if (!decoded) throw new Error('Invalid or expired authentication token');
        if (decoded.type !== 'access') throw new Error('Invalid token type');

        socket.userId = decoded.userId;
        socket.username = decoded.username;
        socket.isAuthenticated = true;

        logger.info('socket.authenticated', { socketId: socket.id, username: socket.username, userId: socket.userId });

        callback?.({
          success: true,
          user: { userId: decoded.userId, username: decoded.username, email: decoded.email }
        });
      } catch (error) {
        socket.isAuthenticated = false;
        logger.warn('socket.authenticate_failed', { socketId: socket.id, error: error.message });
        callback?.({ success: false, message: error.message || 'Authentication failed' });
      }
    });

    socket.on('join', async (options, callback) => {
      if (!socket.isAuthenticated || !socket.userId) {
        return callback?.('Authentication required');
      }

      const { error, user } = addUser({
        id: socket.userId,
        socketId: socket.id,
        username: socket.username,
        ...options
      });
      if (error) return callback?.(error);

      const encryption = new EncryptionManager();
      socketEncryption.set(socket.id, encryption);

      socket.userPublicKey = options.publicKey || encryption.getPublicKey();
      if (options.publicKey) {
        encryption.storeUserPublicKey(user.username, options.publicKey);
      }

      socket.join(user.room);

      const { messages, error: messagesError } = await getRoomMessages(user.room);
      if (!messagesError && messages?.length) {
        socket.emit(
          'previousMessages',
          messages.map((msg) => (msg.getClientEncryptedContent ? msg.getClientEncryptedContent() : msg.encryptedContent))
        );
      }

      socket.emit('message', generateMessage('Admin', 'Welcome!'));

      const usersInRoom = getUsersInRoom(user.room);
      if (usersInRoom.length === 1) {
        const roomKey = encryption.generateRoomKey();
        encryption.storeRoomKey(user.room, roomKey);
        setTimeout(() => socket.emit('encryptionReady', { roomKey }), 100);
      } else {
        socket.broadcast.to(user.room).emit('requestRoomKey', {
          username: user.username,
          publicKey: options.publicKey
        });
      }

      socket.broadcast.to(user.room).emit('userPublicKey', { username: user.username, publicKey: options.publicKey });

      usersInRoom.forEach((existingUser) => {
        if (existingUser.username === user.username) return;
        const existingSocket = Array.from(io.sockets.sockets.values()).find((s) => getUser(s.id)?.id === existingUser.id);
        if (existingSocket?.userPublicKey) {
          socket.emit('userPublicKey', { username: existingUser.username, publicKey: existingSocket.userPublicKey });
        }
      });

      if (usersInRoom.length > 1) {
        const joinMessage = generateMessage('Admin', `${user.username} has joined!`);
        socket.broadcast.to(user.room).emit('message', joinMessage);
        saveMessage(user.room, joinMessage).catch(() => {});
      }

      io.to(user.room).emit('roomData', { room: user.room, users: getUsersInRoom(user.room) });
      callback?.();
    });

    socket.on('sendMessage', async (encryptedMessage, callback) => {
      const user = getUser(socket.id);
      const encryption = socketEncryption.get(socket.id);
      if (!user) return callback?.('User not found');
      if (!encryption) return callback?.('Encryption not initialized');

      const messageObj = { ...generateMessage(user.username, encryptedMessage), isEncrypted: true };
      const saveResult = await saveMessage(user.room, messageObj);
      if (saveResult.error) return callback?.('Failed to save message. Please try again.');

      io.to(user.room).emit('message', messageObj);
      callback?.();
    });

    socket.on('provideRoomKey', (data) => {
      const user = getUser(socket.id);
      const encryption = socketEncryption.get(socket.id);
      if (!user || !encryption) return;

      const targetSocket = Array.from(io.sockets.sockets.values()).find((s) => getUser(s.id)?.username === data.targetUser);
      targetSocket?.emit('roomKey', { encryptedKey: data.encryptedKey, senderPublicKey: socket.userPublicKey });
    });

    socket.on('sendLocation', async ({ latitude, longitude }, callback) => {
      const user = getUser(socket.id);
      if (!user) return callback?.('User not found');

      const locationMessage = generateLocationMessage(user.username, `https://google.com/maps?q=${latitude},${longitude}`);
      const saveResult = await saveMessage(user.room, locationMessage);
      if (saveResult.error) return callback?.('Failed to save location. Please try again.');

      io.to(user.room).emit('locationMessage', locationMessage);
      callback?.();
    });

    socket.on('disconnect', async () => {
      const user = removeUser(socket.id);
      socketEncryption.delete(socket.id);
      if (!user?.room) return;

      const remainingUsers = getUsersInRoom(user.room);
      if (remainingUsers.length > 0) {
        const leaveMessage = generateMessage('Admin', `${user.username} has left!`);
        io.to(user.room).emit('message', leaveMessage);
        saveMessage(user.room, leaveMessage).catch(() => {});
      }

      io.to(user.room).emit('roomData', { room: user.room, users: remainingUsers });
    });
  });
}

module.exports = { registerSocketHandlers };

