require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/chit-chat';

// Connection options for MongoDB Atlas
const connectionOptions = {
    serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
    }
};

// For MongoDB Atlas (mongodb+srv://), use the connection options
// For local MongoDB, use simpler options
const isAtlasConnection = MONGODB_URL.startsWith('mongodb+srv://');

mongoose.connect(MONGODB_URL, isAtlasConnection ? connectionOptions : {}).then(() => {
    if (isAtlasConnection) {
        // Using MongoDB Atlas
    }
}).catch((error) => {
    logger.error('db.mongo.connect_failed', { message: error?.message, name: error?.name });
    process.exit(1); // Exit process if connection fails
});

