const express = require('express');
const socketio = require('socket.io');
const Filter = require('bad-words');
const http = require('http');
const helmet = require('helmet');
require('./db/mongoose');
const { generateMessage, generateLocationMessage } = require('./utils/messages');
const { addUser, removeUser, getUser, getUsersInRoom } = require('./utils/users');
const { saveMessage, getRoomMessages, deleteOldRooms } = require('./utils/rooms');
const EncryptionManager = require('./utils/encryption');

const app = express();

// Security middleware
app.use(helmet());

// Logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    const method = req.method;
    const url = req.url;
    const ip = req.ip || req.connection.remoteAddress;
    
    // Log request
    console.log(`[${timestamp}] ${method} ${url} - IP: ${ip}`);
    
    // Log response when sent
    const originalSend = res.send;
    res.send = function(data) {
        const statusCode = res.statusCode;
        console.log(`[${timestamp}] Response: ${method} ${url} - Status: ${statusCode}`);
        return originalSend.call(this, data);
    };
    
    next();
});

const server = http.createServer(app);
const io = socketio(server, {
    // Socket.IO options with logging
    transports: ['websocket', 'polling'],
    logLevel: 'debug'
}); //create new instance

// Store encryption managers per socket
const socketEncryption = new Map();

const port = process.env.PORT || 3000;

io.on('connection', (socket) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Socket connected - ID: ${socket.id}`);

    socket.on('join', async (options, callback) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] Socket ${socket.id} join event - User: ${options.username}, Room: ${options.room}`);
        
        const { error, user } = addUser({ id: socket.id, ...options });

        if (error) {
            return callback(error);
        }

        // Initialize encryption manager for this socket
        const encryption = new EncryptionManager();
        socketEncryption.set(socket.id, encryption);
        
        // Store user's public key and use it for encryption
        if (options.publicKey) {
            encryption.storeUserPublicKey(user.username, options.publicKey);
            // Store the public key on the socket for later use
            socket.userPublicKey = options.publicKey;
        } else {
            // If no public key provided, use the server-generated one
            socket.userPublicKey = encryption.getPublicKey();
        }

        socket.join(user.room);

        // Load previous messages from MongoDB
        const { messages, error: messagesError } = await getRoomMessages(user.room);
        const hasPreviousMessages = !messagesError && messages && messages.length > 0;
        
        if (hasPreviousMessages) {
            socket.emit('previousMessages', messages);
        }

        // Send welcome message (but don't save it to avoid duplicates on refresh)
        socket.emit('message', generateMessage('Admin', 'Welcome!'));

        // Get users in room before emitting join message
        const usersInRoom = getUsersInRoom(user.room);
        
        // Handle room key setup
        if (usersInRoom.length === 1) {
            // First user in room - generate and store room key
            const roomKey = encryption.generateRoomKey();
            encryption.storeRoomKey(user.room, roomKey);
            
            // Send the room key to the first user so they can store it locally
            setTimeout(() => {
                socket.emit('encryptionReady', { roomKey });
            }, 100);
        } else {
            // Not first user - request room key from existing users
            socket.broadcast.to(user.room).emit('requestRoomKey', {
                username: user.username,
                publicKey: options.publicKey
            });
        }
        
        // Share public key with all users in room
        socket.broadcast.to(user.room).emit('userPublicKey', {
            username: user.username,
            publicKey: options.publicKey
        });
        
        // Send existing users' public keys to new user
        usersInRoom.forEach(existingUser => {
            if (existingUser.username !== user.username) {
                const existingSocket = Array.from(io.sockets.sockets.values()).find(
                    s => getUser(s.id)?.id === existingUser.id
                );
                if (existingSocket && existingSocket.userPublicKey) {
                    socket.emit('userPublicKey', {
                        username: existingUser.username,
                        publicKey: existingSocket.userPublicKey
                    });
                }
            }
        });
        
        // Only emit and save join message if there are other users in the room
        // This prevents saving duplicate join messages when user refreshes alone
        if (usersInRoom.length > 1) {
            const joinMessage = generateMessage('Admin', `${user.username} has joined!`);
            
            // Broadcast immediately for real-time notifications
            // Room state changes should be visible regardless of persistence status
            socket.broadcast.to(user.room).emit('message', joinMessage);
            
            // Save in background (fire-and-forget) - don't block notifications
            saveMessage(user.room, joinMessage).then((result) => {
                // Background save completed
            }).catch((error) => {
                // This catch handles unexpected promise rejections (shouldn't happen, but safety net)
            });
        }

        io.to(user.room).emit('roomData', {
            room: user.room,
            users: usersInRoom
        });

        if (typeof callback === 'function') {
            callback();
        }
    });

    socket.on('sendMessage', async (encryptedMessage, callback) => {
        const timestamp = new Date().toISOString();
        const user = getUser(socket.id);
        console.log(`[${timestamp}] Socket ${socket.id} sendMessage event - User: ${user?.username}, Room: ${user?.room}`);
        
        const encryption = socketEncryption.get(socket.id);

        if (!user) {
            if (typeof callback === 'function') {
                return callback('User not found');
            }
            return;
        }

        if (!encryption) {
            if (typeof callback === 'function') {
                return callback('Encryption not initialized');
            }
            return;
        }

        // Store encrypted message as-is
        const messageObj = {
            ...generateMessage(user.username, encryptedMessage),
            isEncrypted: true
        };
        
        // Save encrypted message to MongoDB first, before broadcasting
        const saveResult = await saveMessage(user.room, messageObj);
        
        if (saveResult.error) {
            if (typeof callback === 'function') {
                return callback('Failed to save message. Please try again.');
            }
            return;
        }
        
        // Only broadcast if save was successful
        io.to(user.room).emit('message', messageObj);
        if (typeof callback === 'function') {
            callback();
        }
    });

    // Handle room key exchange
    socket.on('provideRoomKey', (data) => {
        const user = getUser(socket.id);
        const encryption = socketEncryption.get(socket.id);
        
        if (!user || !encryption) {
            return;
        }

        // Forward encrypted room key to target user
        const targetSocket = Array.from(io.sockets.sockets.values()).find(s => {
            const targetUser = getUser(s.id);
            return targetUser && targetUser.username === data.targetUser;
        });

        if (targetSocket) {
            targetSocket.emit('roomKey', {
                encryptedKey: data.encryptedKey,
                senderPublicKey: socket.userPublicKey // Use the original sender's public key
            });
        }
    });

    socket.on('sendLocation', async ({ latitude, longitude }, callback) => {
        const timestamp = new Date().toISOString();
        const user = getUser(socket.id);
        console.log(`[${timestamp}] Socket ${socket.id} sendLocation event - User: ${user?.username}, Room: ${user?.room}, Coords: [${latitude}, ${longitude}]`);

        if (!user) {
            if (typeof callback === 'function') {
                return callback('User not found');
            }
            return;
        }

        const locationMessage = generateLocationMessage(
            user.username,
            `https://google.com/maps?q=${latitude},${longitude}`
        );
        
        // Save location message to MongoDB first, before broadcasting
        const saveResult = await saveMessage(user.room, locationMessage);
        
        if (saveResult.error) {
            return callback('Failed to save location. Please try again.');
        }
        
        // Only broadcast if save was successful
        io.to(user.room).emit('locationMessage', locationMessage);
        if (typeof callback === 'function') {
            callback();
        }
    });

    socket.on('disconnect', async () => {
        const timestamp = new Date().toISOString();
        const user = removeUser(socket.id);
        console.log(`[${timestamp}] Socket disconnected - ID: ${socket.id}, User: ${user?.username}, Room: ${user?.room}`);

        // Clean up encryption manager
        socketEncryption.delete(socket.id);

        // Prevent Azure crash if user or user.room is undefined
        if (!user || !user.room) {
            return;
        }

        // Get remaining users after removing this user
        const remainingUsers = getUsersInRoom(user.room);
        
        // Only emit and save leave message if there are still other users in the room
        // This prevents saving duplicate leave messages when user refreshes alone
        if (remainingUsers.length > 0) {
            const leaveMessage = generateMessage('Admin', `${user.username} has left!`);
            
            // Broadcast immediately for real-time notifications
            // Room state changes should be visible regardless of persistence status
            io.to(user.room).emit('message', leaveMessage);
            
            // Save in background (fire-and-forget) - don't block notifications
            saveMessage(user.room, leaveMessage).then((result) => {
                // Background save completed
            }).catch((error) => {
                // This catch handles unexpected promise rejections (shouldn't happen, but safety net)
            });
        }

        io.to(user.room).emit('roomData', {
            room: user.room,
            users: remainingUsers
        });
    });
});

// Schedule cleanup task to run daily at midnight
const cleanupOldRooms = async () => {
    await deleteOldRooms();
};

// Run cleanup once on server start
cleanupOldRooms();

// Schedule cleanup to run every 24 hours (86400000 ms)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
setInterval(cleanupOldRooms, CLEANUP_INTERVAL);

server.listen(port, () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Server started on port ${port}`);
});
