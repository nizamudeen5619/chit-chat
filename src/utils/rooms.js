const Room = require('../models/Room');

// Save a message to a room
const saveMessage = async (roomName, message) => {
    try {
        roomName = roomName.trim().toLowerCase();
        
        // Use findOneAndUpdate with upsert to handle race conditions atomically
        // This ensures only one room is created even with concurrent requests
        const room = await Room.findOneAndUpdate(
            { roomName },
            { 
                $push: { messages: message },
                $setOnInsert: { roomName } // Only set roomName if creating new document
            },
            { 
                upsert: true, 
                new: true,
                setDefaultsOnInsert: true
            }
        );
        
        return { success: true };
    } catch (error) {
        // Handle duplicate key errors (shouldn't happen with upsert, but just in case)
        if (error.code === 11000) {
            // Duplicate key error - room was created by another request
            // Retry by finding the existing room and updating it
            try {
                const room = await Room.findOne({ roomName });
                if (room) {
                    room.messages.push(message);
                    await room.save();
                    return { success: true };
                } else {
                    // Room not found after duplicate key error - unexpected state
                    console.error('Room not found after duplicate key error:', roomName);
                    return { error: 'Room not found after duplicate key error. Please try again.' };
                }
            } catch (retryError) {
                console.error('Error retrying save message:', retryError);
                return { error: retryError.message };
            }
        }
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

