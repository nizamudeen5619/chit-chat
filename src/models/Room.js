const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true
    },
    text: {
        type: mongoose.Schema.Types.Mixed,
        default: null
    },
    url: {
        type: String,
        default: null
    },
    isEncrypted: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Number,
        required: true
    }
}, {
    timestamps: false
});

const roomSchema = new mongoose.Schema({
    roomName: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    messages: [messageSchema]
}, {
    timestamps: true
});

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;

