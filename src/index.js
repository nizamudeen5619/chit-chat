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
const { getConfig } = require('./config/env');
const logger = require('./utils/logger');
require('./db/mongoose');
const { generateMessage, generateLocationMessage } = require('./utils/messages');
const { addUser, removeUser, getUser, getUsersInRoom } = require('./utils/users');
const { saveMessage, getRoomMessages, deleteOldRooms } = require('./utils/rooms');
const EncryptionManager = require('./utils/encryption');

const app = express();
const config = getConfig();

// Security middleware
app.use(helmet());

// CORS middleware
const allowedOrigins = config.corsOrigins;

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
    logger.info('http.request', { method, url, ip });
    
    // Log response when sent
    const originalSend = res.send;
    res.send = function(data) {
        const statusCode = res.statusCode;
        logger.info('http.response', { method, url, statusCode });
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

const { registerSocketHandlers } = require('./realtime/socketServer');
registerSocketHandlers(io);

const port = config.port;

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
