const Room = require('../models/Room');

// Save a message to a room
const saveMessage = async (roomName, message) => {
    try {
        roomName = roomName.trim().toLowerCase();
        
        let room = await Room.findOne({ roomName });
        
        if (!room) {
            room = new Room({ roomName, messages: [] });
        }
        
        room.messages.push(message);
        await room.save();
        
        return { success: true };
    } catch (error) {
        console.error('Error saving message:', error);
        return { error: error.message };
    }
};

// Get all messages for a room
const getRoomMessages = async (roomName) => {
    try {
        roomName = roomName.trim().toLowerCase();
        
        const room = await Room.findOne({ roomName });
        
        if (!room) {
            return { messages: [] };
        }
        
        return { messages: room.messages };
    } catch (error) {
        console.error('Error getting room messages:', error);
        return { error: error.message };
    }
};

// Delete rooms that haven't been updated in the last 7 days
const deleteOldRooms = async () => {
    try {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        
        const result = await Room.deleteMany({
            updatedAt: { $lt: oneWeekAgo }
        });
        
        if (result.deletedCount > 0) {
            console.log(`Deleted ${result.deletedCount} room(s) older than 1 week`);
        }
        
        return { 
            success: true, 
            deletedCount: result.deletedCount 
        };
    } catch (error) {
        console.error('Error deleting old rooms:', error);
        return { error: error.message };
    }
};

module.exports = {
    saveMessage,
    getRoomMessages,
    deleteOldRooms
};

