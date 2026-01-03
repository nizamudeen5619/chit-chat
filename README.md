# Chatting Room App

A real-time chatting room application with end-to-end encryption, powered by Express, Socket.IO, and modern cryptography libraries.

## Dependencies

- **bad-words:** ^3.0.4
- **express:** ^4.17.1
- **socket.io:** ^4.2.0
- **crypto-js:** ^4.2.0
- **tweetnacl:** ^1.0.3
- **tweetnacl-util:** ^0.15.1

## Features

- **End-to-End Encryption**: All messages are encrypted client-side using XSalsa20-Poly1305 algorithm
- **Secure Key Exchange**: Room keys are exchanged using Curve25519 elliptic curve cryptography
- **Real-time chat functionality** with Socket.IO
- **Automatic filtering of offensive language** using "bad-words"
- **Message persistence** with MongoDB
- **Location sharing** capabilities
- **Responsive design** with modern UI
- **Admin messages** for join/leave notifications

## Security Features

- **Zero-Knowledge Server**: Server cannot read message content - only stores encrypted payloads
- **Per-Room Encryption**: Each chat room has its own unique encryption key
- **Secure Key Management**: Keys are generated client-side and exchanged securely
- **Persistent Encryption**: Room keys are stored locally for seamless reconnection
- **Forward Secrecy**: New room keys are generated for each room session

## Setup Instructions

1. Clone the repository
   ```bash
   git clone https://github.com/berserker5619/chit-chat
   cd chit-chat
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Set up environment variables
   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB connection string
   ```

4. Start the server
   ```bash
   npm start
   # For development with auto-reload:
   npm run dev
   ```

5. Access the app in your browser
   - http://localhost:3000

## Usage

1. **Join a Room**: Enter a username and room name to start chatting
2. **Secure Messaging**: All messages are automatically encrypted before sending
3. **Location Sharing**: Share your location with other room participants
4. **Real-time Updates**: See messages and user presence updates instantly

## How Encryption Works

1. **Key Generation**: Each user generates a unique key pair upon joining
2. **Room Key Setup**: First user in a room creates a shared encryption key
3. **Key Exchange**: New users receive the room key encrypted with their public key
4. **Message Encryption**: Messages are encrypted client-side before transmission
5. **Secure Storage**: Only encrypted data is stored on the server

## Technical Architecture

- **Frontend**: Vanilla JavaScript with NaCl cryptography
- **Backend**: Node.js with Express and Socket.IO
- **Database**: MongoDB for message persistence
- **Encryption**: TweetNaCl for cryptographic operations
- **Real-time**: Socket.IO for instant messaging

## Development

- **Start development server**: `npm run dev`
- **View logs**: Check console for encryption and connection logs
- **Debug mode**: Browser console shows encryption/decryption status

## Security Notes

- Messages are encrypted using industry-standard cryptographic algorithms
- The server has no ability to decrypt message content
- Room keys are stored locally in browser localStorage
- Admin messages (join/leave notifications) are not encrypted for functionality
