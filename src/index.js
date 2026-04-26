const express = require('express');
const socketio = require('socket.io');
const Filter = require('bad-words');
const http = require('http');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const AuthService = require('./services/AuthService');
const authRoutes = require('./routes/auth');
const { authenticateToken } = require('./middleware/auth');
require('./db/mongoose');
const { generateMessage, generateLocationMessage } = require('./utils/messages');
const { addUser, removeUser, getUser, getUsersInRoom } = require('./utils/users');
const { saveMessage, getRoomMessages, deleteOldRooms } = require('./utils/rooms');
const EncryptionManager = require('./utils/encryption');

const app = express();

// Security middleware
app.use(helmet());

// CORS middleware
const parseAllowedOrigins = () => {
    const raw = process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || "http://localhost:4200";
    return raw.split(',').map(o => o.trim()).filter(Boolean);
};

const allowedOrigins = parseAllowedOrigins();

app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser clients and same-origin requests
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('CORS origin not allowed'), false);
    },
    methods: ["GET", "POST", "PUT"],
    credentials: true
}));

// Body parser middleware
app.use(express.json());

// Cookie parser (required for refresh-cookie auth)
app.use(cookieParser());

// Routes
app.use('/api/auth', authRoutes);

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
    // Socket.IO options with CORS and logging
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    logLevel: 'debug'
}); //create new instance

// Store encryption managers per socket
const socketEncryption = new Map();

const port = process.env.PORT || 3000;

io.on('connection', (socket) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Socket connected - ID: ${socket.id}`);

    // Enhanced authentication middleware for Socket.IO
    socket.on('authenticate', async (token, callback) => {
        try {
            if (!token) {
                throw new Error('Authentication token required');
            }

            const decoded = AuthService.verifyAccessToken(token);
            
            if (!decoded) {
                throw new Error('Invalid or expired authentication token');
            }

            // Additional validation
            if (decoded.type !== 'access') {
                throw new Error('Invalid token type');
            }

            // Attach user info to socket
            socket.userId = decoded.userId;
            socket.username = decoded.username;
            socket.isAuthenticated = true;
            
            console.log(`[${timestamp}] Socket ${socket.id} authenticated - User: ${socket.username} (ID: ${socket.userId})`);
            
            if (typeof callback === 'function') {
                callback({ 
                    success: true, 
                    user: {
                        userId: decoded.userId,
                        username: decoded.username,
                        email: decoded.email
                    }
                });
            }
        } catch (error) {
            console.error(`[${timestamp}] Socket ${socket.id} authentication failed:`, error.message);
            socket.isAuthenticated = false;
            
            if (typeof callback === 'function') {
                callback({ 
                    success: false, 
                    message: error.message || 'Authentication failed' 
                });
            }
        }
    });

    socket.on('join', async (options, callback) => {
        const timestamp = new Date().toISOString();
        
        // Check if socket is authenticated
        if (!socket.isAuthenticated || !socket.userId) {
            console.error(`[${timestamp}] Socket ${socket.id} join attempt without authentication`);
            return callback('Authentication required');
        }

        console.log(`[${timestamp}] Socket ${socket.id} join event - User: ${socket.username}, Room: ${options.room}`);
        
        const { error, user } = addUser({ 
            id: socket.userId, 
            username: socket.username,
            socketId: socket.id,
            ...options 
        });

        if (error) {
            return callback(error);
        }

        // Initialize encryption manager for this socket
        const encryption = new EncryptionManager();
        socketEncryption.set(socket.id, encryption);
        
        // Store user's public key and use it for encryption
        if (options.publicKey) {
            encryption.storeUserPublicKey(user.username, options.publicKey);
            // Store public key on the socket for later use
            socket.userPublicKey = options.publicKey;
        } else {
            // If no public key provided, use server-generated one
            socket.userPublicKey = encryption.getPublicKey();
        }

        socket.join(user.room);

        // Load previous messages from MongoDB
        const { messages, error: messagesError } = await getRoomMessages(user.room);
        const hasPreviousMessages = !messagesError && messages && messages.length > 0;
        
        if (hasPreviousMessages) {
            // Decrypt server layer and send client-encrypted messages
            const decryptedMessages = messages.map(msg => {
                if (msg.getClientEncryptedContent) {
                    return msg.getClientEncryptedContent();
                }
                return msg.encryptedContent;
            });
            socket.emit('previousMessages', decryptedMessages);
        }

        // Send welcome message (but don't save it to avoid duplicates on refresh)
        socket.emit('message', generateMessage('Admin', 'Welcome!'));

        // Get users in room before emitting join message
        const usersInRoom = getUsersInRoom(user.room);
        
        // Handle room key setup
        console.log(`[${timestamp}] Users in room: ${usersInRoom.length}`);
        if (usersInRoom.length === 1) {
            // First user in room - generate and store room key
            console.log(`[${timestamp}] Generating room key for first user`);
            const roomKey = encryption.generateRoomKey();
            encryption.storeRoomKey(user.room, roomKey);
            console.log(`[${timestamp}] Room key generated, sending to user`);
            
            // Send the room key to the first user so they can store it locally
            setTimeout(() => {
                console.log(`[${timestamp}] Emitting encryptionReady event`);
                socket.emit('encryptionReady', { roomKey });
            }, 100);
        } else {
            // Not first user - request room key from existing users
            console.log(`[${timestamp}] Requesting room key from existing users`);
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
        
        // Only emit and save join message if there are other users in room
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
        console.log(`[${timestamp}] Socket ${socket.id} disconnecting...`);
        console.log(`[${timestamp}] Current users in array:`, require('./utils/users').users.map(u => ({ id: u.id, username: u.username, room: u.room })));
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

server.listen(port, () => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Server started on port ${port}`);
});
