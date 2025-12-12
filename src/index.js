const express = require('express');
const socketio = require('socket.io');
const Filter = require('bad-words');
const http = require('http');
const path = require('path');
require('./db/mongoose');
const { generateMessage, generateLocationMessage } = require('./utils/messages');
const { addUser, removeUser, getUser, getUsersInRoom } = require('./utils/users');
const { saveMessage, getRoomMessages, deleteOldRooms } = require('./utils/rooms');

const app = express();
const server = http.createServer(app);
const io = socketio(server); //create new instance

const port = process.env.PORT || 3000;
const publicDirectoryPath = path.join(__dirname, '../public');

app.use(express.static(publicDirectoryPath));

io.on('connection', (socket) => {
    console.log('New websocket connection');

    socket.on('join', async (options, callback) => {
        const { error, user } = addUser({ id: socket.id, ...options });

        if (error) {
            return callback(error);
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
        
        // Only emit and save join message if there are other users in the room
        // This prevents saving duplicate join messages when user refreshes alone
        if (usersInRoom.length > 1) {
            const joinMessage = generateMessage('Admin', `${user.username} has joined!`);
            
            // Broadcast immediately for real-time notifications
            // Room state changes should be visible regardless of persistence status
            socket.broadcast.to(user.room).emit('message', joinMessage);
            
            // Save in background (fire-and-forget) - don't block notifications
            saveMessage(user.room, joinMessage).then((result) => {
                if (result.error) {
                    console.error('Failed to save join message (background):', result.error);
                }
            }).catch((error) => {
                // This catch handles unexpected promise rejections (shouldn't happen, but safety net)
                console.error('Unexpected error saving join message (background):', error);
            });
        }

        io.to(user.room).emit('roomData', {
            room: user.room,
            users: usersInRoom
        });

        callback();
    });

    socket.on('sendMessage', async (message, callback) => {
        const user = getUser(socket.id);
        const filter = new Filter();

        if (!user) {
            return callback('User not found');
        }

        if (filter.isProfane(message)) {
            return callback('Profanity is not allowed');
        }

        const messageObj = generateMessage(user.username, message);
        
        // Save message to MongoDB first, before broadcasting
        const saveResult = await saveMessage(user.room, messageObj);
        
        if (saveResult.error) {
            console.error('Failed to save message:', saveResult.error);
            return callback('Failed to save message. Please try again.');
        }
        
        // Only broadcast if save was successful
        io.to(user.room).emit('message', messageObj);
        callback();
    });

    socket.on('sendLocation', async ({ latitude, longitude }, callback) => {
        const user = getUser(socket.id);

        if (!user) {
            return callback('User not found');
        }

        const locationMessage = generateLocationMessage(
            user.username,
            `https://google.com/maps?q=${latitude},${longitude}`
        );
        
        // Save location message to MongoDB first, before broadcasting
        const saveResult = await saveMessage(user.room, locationMessage);
        
        if (saveResult.error) {
            console.error('Failed to save location message:', saveResult.error);
            return callback('Failed to save location. Please try again.');
        }
        
        // Only broadcast if save was successful
        io.to(user.room).emit('locationMessage', locationMessage);
        callback();
    });

    socket.on('disconnect', async () => {
        const user = removeUser(socket.id);

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
                if (result.error) {
                    console.error('Failed to save leave message (background):', result.error);
                }
            }).catch((error) => {
                // This catch handles unexpected promise rejections (shouldn't happen, but safety net)
                console.error('Unexpected error saving leave message (background):', error);
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
    console.log('Running scheduled cleanup for old rooms...');
    await deleteOldRooms();
};

// Run cleanup once on server start
cleanupOldRooms();

// Schedule cleanup to run every 24 hours (86400000 ms)
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
setInterval(cleanupOldRooms, CLEANUP_INTERVAL);

server.listen(port, () => {
    console.log('Server running on port ' + port);
    console.log('Room cleanup scheduled: runs every 24 hours (deletes rooms older than 1 week)');
});
