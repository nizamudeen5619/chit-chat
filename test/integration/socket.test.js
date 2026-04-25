const http = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const jwt = require('jsonwebtoken');

// Import the server logic
const { addUser, removeUser, getUser, getUsersInRoom } = require('../../src/utils/users');
const { generateMessage, generateLocationMessage } = require('../../src/utils/messages');
const EncryptionManager = require('../../src/utils/encryption');

// Mock AuthService for testing
let clientCounter = 0;
const mockAuthService = {
  verifyAccessToken: (token) => {
    try {
      if (!token || token === 'invalid') {
        return null;
      }
      // Generate unique IDs for each client/socket
      const clientId = `client-${Date.now()}-${Math.random()}`;
      // Simple mock decode for test tokens
      return {
        userId: clientId,
        username: 'testuser',
        email: 'test@example.com',
        type: 'access'
      };
    } catch (error) {
      return null;
    }
  }
};

describe('Socket.IO Integration Tests', () => {
  let io, serverSocket, clientSocket, clientSocket2;
  let socketEncryption;
  const port = 3001; // Use different port for testing

  beforeAll((done) => {
    const httpServer = http.createServer();
    io = new Server(httpServer);
    
    // Initialize socket encryption map
    socketEncryption = new Map();
    
    // Setup server event handlers (similar to main server logic)
    io.on('connection', (socket) => {
      // Authenticate handler
      socket.on('authenticate', async (token, callback) => {
        try {
          if (!token) {
            throw new Error('Authentication token required');
          }

          const decoded = mockAuthService.verifyAccessToken(token);
          
          if (!decoded) {
            throw new Error('Invalid or expired authentication token');
          }

          if (decoded.type !== 'access') {
            throw new Error('Invalid token type');
          }

          socket.userId = decoded.userId;
          socket.username = decoded.username;
          socket.isAuthenticated = true;

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
        // Check if socket is authenticated
        if (!socket.isAuthenticated || !socket.userId) {
          if (typeof callback === 'function') {
            return callback('Authentication required');
          }
          return;
        }

        // Validate required fields
        if (!options.room || !socket.username) {
          if (typeof callback === 'function') {
            return callback('Username and room are required');
          }
          return;
        }

        const { error, user } = addUser({ 
          id: socket.userId, 
          username: socket.username,
          socketId: socket.id,
          ...options 
        });

        if (error) {
          return callback(typeof callback === 'function' ? callback(error) : undefined);
        }

        // Initialize encryption manager for this socket
        const encryption = new EncryptionManager();
        socketEncryption.set(socket.id, encryption);
        
        // Store user's public key and use it for encryption
        if (options.publicKey) {
          encryption.storeUserPublicKey(user.username, options.publicKey);
          socket.userPublicKey = options.publicKey;
        } else {
          // If no public key provided, use the server-generated one
          socket.userPublicKey = encryption.getPublicKey();
        }

        socket.join(user.room);

        // Send welcome message
        socket.emit('message', generateMessage('Admin', 'Welcome!'));

        // Get users in room before emitting join message
        const usersInRoom = getUsersInRoom(user.room);
        
        // Handle room key setup
        if (usersInRoom.length === 1) {
          // First user in room - generate and store room key
          const roomKey = encryption.generateRoomKey();
          encryption.storeRoomKey(user.room, roomKey);
          
          // Send the room key to the first user
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
            // Find the socket for the existing user by matching their userId
            const existingSocket = Array.from(io.sockets.sockets.values()).find(
              s => s.userId === existingUser.id
            );
            if (existingSocket && existingSocket.userPublicKey) {
              socket.emit('userPublicKey', {
                username: existingUser.username,
                publicKey: existingSocket.userPublicKey
              });
            }
          }
        });
        
        // Only emit join message if there are other users in the room
        if (usersInRoom.length > 1) {
          const joinMessage = generateMessage('Admin', `${user.username} has joined!`);
          socket.broadcast.to(user.room).emit('message', joinMessage);
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
        const user = getUser(socket.userId);
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

        const messageObj = {
          ...generateMessage(user.username, encryptedMessage),
          isEncrypted: true
        };
        
        // Broadcast message to room
        io.to(user.room).emit('message', messageObj);
        if (typeof callback === 'function') {
          callback();
        }
      });

      socket.on('sendLocation', async ({ latitude, longitude }, callback) => {
        const user = getUser(socket.userId);

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
        
        io.to(user.room).emit('locationMessage', locationMessage);
        if (typeof callback === 'function') {
          callback();
        }
      });

      socket.on('disconnect', () => {
        const user = removeUser(socket.userId);

        // Clean up encryption manager
        socketEncryption.delete(socket.id);

        if (!user || !user.room) {
          return;
        }

        const remainingUsers = getUsersInRoom(user.room);
        
        // Only emit leave message if there are still other users in the room
        if (remainingUsers.length > 0) {
          const leaveMessage = generateMessage('Admin', `${user.username} has left!`);
          io.to(user.room).emit('message', leaveMessage);
        }

        io.to(user.room).emit('roomData', {
          room: user.room,
          users: remainingUsers
        });
      });
    });

    httpServer.listen(port, done);
  });

  afterAll(() => {
    io.close();
    if (clientSocket) clientSocket.close();
    if (clientSocket2) clientSocket2.close();
  });

  beforeEach((done) => {
    // Clear users array
    const { users } = require('../../src/utils/users');
    users.length = 0;
    
    // Clear socket encryption map from previous tests
    socketEncryption.clear();
    
    // Setup client sockets
    clientSocket = new Client(`http://localhost:${port}`);
    clientSocket2 = new Client(`http://localhost:${port}`);
    
    let connected = 0;
    const checkBoth = () => {
      connected++;
      if (connected === 2) {
        done();
      }
    };
    
    clientSocket.on('connect', checkBoth);
    clientSocket2.on('connect', checkBoth);
  });

  afterEach(() => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.removeAllListeners();
    }
    if (clientSocket2 && clientSocket2.connected) {
      clientSocket2.removeAllListeners();
    }
  });

  // Helper function to authenticate before join
  const authenticateAndJoin = (socket, options, callback) => {
    socket.emit('authenticate', 'valid-test-token', (authResponse) => {
      if (authResponse && authResponse.success) {
        socket.emit('join', options, callback);
      } else {
        callback('Authentication failed');
      }
    });
  };

  describe('User Connection and Room Management', () => {
    it('should connect clients successfully', (done) => {
      expect(clientSocket.connected).toBe(true);
      done();
    });

    it('should authenticate successfully', (done) => {
      clientSocket.emit('authenticate', 'valid-test-token', (response) => {
        expect(response.success).toBe(true);
        expect(response.user).toBeDefined();
        expect(response.user.username).toBe('testuser');
        done();
      });
    });

    it('should join room successfully', (done) => {
      authenticateAndJoin(clientSocket, { 
        username: 'testUser', 
        room: 'testRoom',
        publicKey: 'testPublicKey'
      }, (response) => {
        expect(response).toBeUndefined(); // No error means success
        done();
      });
    });

    it('should receive welcome message', (done) => {
      clientSocket.on('message', (message) => {
        if (message.username === 'Admin' && message.text === 'Welcome!') {
          done();
        }
      });

      authenticateAndJoin(clientSocket, { 
        username: 'testUser', 
        room: 'testRoom',
        publicKey: 'testPublicKey'
      });
    });

    it('should handle duplicate usernames in same room', (done) => {
      authenticateAndJoin(clientSocket, { 
        username: 'testUser', 
        room: 'testRoom',
        publicKey: 'testPublicKey'
      }, () => {
        // First user authenticated and joined successfully
        clientSocket2.emit('authenticate', 'valid-test-token', (authResponse) => {
          if (authResponse.success) {
            clientSocket2.emit('join', { 
              username: 'testUser', 
              room: 'testRoom',
              publicKey: 'testPublicKey2'
            }, (response) => {
              expect(response).toBe('Username already taken');
              done();
            });
          }
        });
      });
    });

    it('should allow same username in different rooms', (done) => {
      authenticateAndJoin(clientSocket, { 
        username: 'testUser', 
        room: 'room1',
        publicKey: 'testPublicKey'
      });

      clientSocket2.emit('authenticate', 'valid-test-token', (authResponse) => {
        if (authResponse.success) {
          clientSocket2.emit('join', { 
            username: 'testUser', 
            room: 'room2',
            publicKey: 'testPublicKey2'
          }, (response) => {
            expect(response).toBeUndefined(); // No error means success
            done();
          });
        }
      });
    });
  });

  describe('Message Broadcasting', () => {
    beforeEach((done) => {
      let joinCount = 0;
      const checkBothJoined = () => {
        joinCount++;
        if (joinCount === 2) {
          done();
        }
      };

      clientSocket.emit('authenticate', 'valid-test-token', (authResponse1) => {
        if (authResponse1.success) {
          clientSocket.emit('join', { 
            username: 'user1', 
            room: 'testRoom',
            publicKey: 'testPublicKey1'
          }, checkBothJoined);
        }
      });

      clientSocket2.emit('authenticate', 'valid-test-token', (authResponse2) => {
        if (authResponse2.success) {
          clientSocket2.emit('join', { 
            username: 'user2', 
            room: 'testRoom',
            publicKey: 'testPublicKey2'
          }, checkBothJoined);
        }
      });
    });

    it('should broadcast messages to room', (done) => {
      const encryptedMessage = { encrypted: 'abc123', nonce: 'def456' };
      
      clientSocket2.on('message', (message) => {
        if (message.username === 'user1' && message.isEncrypted) {
          expect(message.text).toEqual(encryptedMessage);
          done();
        }
      });

      clientSocket.emit('sendMessage', encryptedMessage, (response) => {
        expect(response).toBeUndefined(); // No error means success
      });
    });

    it('should broadcast location messages to room', (done) => {
      clientSocket2.on('locationMessage', (message) => {
        if (message.username === 'user1') {
          expect(message.url).toBe('https://google.com/maps?q=40.7128,-74.006');
          done();
        }
      });

      clientSocket.emit('sendLocation', { 
        latitude: 40.7128, 
        longitude: -74.0060 
      }, (response) => {
        expect(response).toBeUndefined(); // No error means success
      });
    });

    it('should not receive messages from other rooms', (done) => {
      // Join user1 to testRoom
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse1) => {
        if (authResponse1.success) {
          clientSocket.emit('join', { 
            username: 'user1', 
            room: 'testRoom',
            publicKey: 'testPublicKey1'
          }, () => {
            // User1 joined testRoom, now join user3 to otherRoom
            const clientSocket3 = new Client(`http://localhost:${port}`);
            
            clientSocket3.on('connect', () => {
              clientSocket3.emit('authenticate', 'valid-test-token', (authResponse3) => {
                if (authResponse3.success) {
                  clientSocket3.emit('join', { 
                    username: 'user3', 
                    room: 'otherRoom',
                    publicKey: 'testPublicKey3'
                  });

                  let messageReceived = false;
                  clientSocket3.on('message', (message) => {
                    // Messages like welcome and joins are OK, but encrypted messages should not arrive
                    if (message.isEncrypted) {
                      messageReceived = true;
                    }
                  });

                  // Wait for client3 to join, then send message from user1 in testRoom
                  setTimeout(() => {
                    clientSocket.emit('sendMessage', 'encryptedMessage123');
                    
                    // If no encrypted message received within 200ms, test passes
                    setTimeout(() => {
                      clientSocket3.close();
                      if (!messageReceived) {
                        done();
                      } else {
                        done(new Error('User in different room received encrypted message'));
                      }
                    }, 200);
                  }, 100);
                }
              });
            });
          });
        }
      });
    });
  });

  describe('Room Data Updates', () => {
    it('should update room data when user joins', (done) => {
      let roomDataReceived = false;
      
      clientSocket.on('roomData', (data) => {
        if (data.room === 'testroom') {
          expect(data.users).toHaveLength(1);
          expect(data.users[0].username).toBe('user1');
          roomDataReceived = true;
          done();
        }
      });
      
      authenticateAndJoin(clientSocket, { 
        username: 'user1', 
        room: 'testRoom',
        publicKey: 'testPublicKey1'
      }, () => {
        // Join callback completed
      });
    });

    it('should update room data when second user joins', (done) => {
      // First user joins
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse1) => {
        if (authResponse1.success) {
          clientSocket.emit('join', { 
            username: 'user1', 
            room: 'testRoom',
            publicKey: 'testPublicKey1'
          }, () => {
            // First user joined, now set up listener for second user
            clientSocket2.on('roomData', (data) => {
              if (data.room === 'testroom' && data.users.length === 2) {
                expect(data.users.map(u => u.username)).toContain('user1');
                expect(data.users.map(u => u.username)).toContain('user2');
                done();
              }
            });

            // Now second user joins
            clientSocket2.emit('authenticate', 'valid-test-token', (authResponse2) => {
              if (authResponse2.success) {
                clientSocket2.emit('join', { 
                  username: 'user2', 
                  room: 'testRoom',
                  publicKey: 'testPublicKey2'
                });
              }
            });
          });
        }
      });
    });

    it('should update room data when user disconnects', (done) => {
      // First user joins
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse1) => {
        if (authResponse1.success) {
          clientSocket.emit('join', { 
        username: 'user1', 
        room: 'testRoom',
        publicKey: 'testPublicKey1'
      }, () => {
        // First user joined, now set up listener for disconnect event
        clientSocket.on('roomData', (data) => {
          if (data.room === 'testroom' && data.users.length === 1) {
            expect(data.users[0].username).toBe('user1');
            done();
          }
        });

        // Second user joins then disconnects
        clientSocket2.emit('authenticate', 'valid-test-token', (authResponse2) => {
          if (authResponse2.success) {
            clientSocket2.emit('join', { 
              username: 'user2', 
              room: 'testRoom',
              publicKey: 'testPublicKey2'
            }, () => {
              setTimeout(() => {
                clientSocket2.close();
              }, 100);
            });
          }
        });
      });
        }
      });
    });
  });

  describe('Encryption Key Exchange', () => {
    it('should send room key to first user', (done) => {
      clientSocket.on('encryptionReady', (data) => {
        expect(data.roomKey).toBeDefined();
        done();
      });

      authenticateAndJoin(clientSocket, { 
        username: 'user1', 
        room: 'testRoom',
        publicKey: 'testPublicKey1'
      });
    });

    it('should request room key for new user', (done) => {
      // Ensure sockets are connected before setting up listeners
      setTimeout(() => {
        // Set up listener for requestRoomKey on the FIRST user's socket
        // (because the SECOND user joining will trigger the broadcast)
        clientSocket.on('requestRoomKey', (data) => {
          expect(data.username).toBe('user2');
          expect(data.publicKey).toBe('testPublicKey2');
          done();
        });

        // First user joins
        clientSocket.emit('authenticate', 'valid-test-token', (authResponse1) => {
          if (authResponse1.success) {
            clientSocket.emit('join', { 
              username: 'user1', 
              room: 'testRoom',
              publicKey: 'testPublicKey1'
            }, () => {
              // First user joined, now second user joins
              clientSocket2.emit('authenticate', 'valid-test-token', (authResponse2) => {
                if (authResponse2.success) {
                  clientSocket2.emit('join', { 
                    username: 'user2', 
                    room: 'testRoom',
                    publicKey: 'testPublicKey2'
                  });
                }
              });
            });
          }
        });
      }, 50);
    });

    it('should exchange public keys between users', (done) => {
      let receivedKeys = 0;
      
      // First user joins
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse1) => {
        if (authResponse1.success) {
          clientSocket.emit('join', { 
            username: 'user1', 
            room: 'testRoom',
            publicKey: 'testPublicKey1'
          }, () => {
            // Set up listeners for both users
            clientSocket.on('userPublicKey', (data) => {
              if (data.username === 'user2') {
                expect(data.publicKey).toBe('testPublicKey2');
                receivedKeys++;
                if (receivedKeys === 2) done();
              }
            });

            clientSocket2.on('userPublicKey', (data) => {
              if (data.username === 'user1') {
                expect(data.publicKey).toBe('testPublicKey1');
                receivedKeys++;
                if (receivedKeys === 2) done();
              }
            });

            // Second user joins
            clientSocket2.emit('authenticate', 'valid-test-token', (authResponse2) => {
              if (authResponse2.success) {
                clientSocket2.emit('join', { 
                  username: 'user2', 
                  room: 'testRoom',
                  publicKey: 'testPublicKey2'
                }, () => {
                  // Join completed, listeners are set up above
                });
              }
            });
          });
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing room', (done) => {
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse) => {
        if (authResponse.success) {
          clientSocket.emit('join', { 
            publicKey: 'testPublicKey'
            // room is missing
          }, (response) => {
            expect(response).toBe('Username and room are required');
            done();
          });
        }
      });
    });

    it('should handle missing room', (done) => {
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse) => {
        if (authResponse.success) {
          clientSocket.emit('join', { 
            username: 'testUser',
            publicKey: 'testPublicKey'
          }, (response) => {
            expect(response).toBe('Username and room are required');
            done();
          });
        }
      });
    });

    it('should handle send message without joining', (done) => {
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse) => {
        if (authResponse.success) {
          clientSocket.emit('sendMessage', { encrypted: 'abc123', nonce: 'def456' }, (response) => {
            expect(response).toBe('User not found');
            done();
          });
        }
      });
    });

    it('should handle send location without joining', (done) => {
      clientSocket.emit('authenticate', 'valid-test-token', (authResponse) => {
        if (authResponse.success) {
          clientSocket.emit('sendLocation', { 
            latitude: 40.7128, 
            longitude: -74.0060 
          }, (response) => {
            expect(response).toBe('User not found');
            done();
          });
        }
      });
    });
  });
});
