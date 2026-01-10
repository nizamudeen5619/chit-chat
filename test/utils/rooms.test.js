const { saveMessage, getRoomMessages, deleteOldRooms } = require('../../src/utils/rooms');
const Room = require('../../src/models/Room');

// Mock the Room model
jest.mock('../../src/models/Room');

describe('Room Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveMessage', () => {
    it('should save message successfully', async () => {
      const mockRoom = {
        roomName: 'testroom',
        messages: []
      };
      
      Room.findOneAndUpdate.mockResolvedValue(mockRoom);
      
      const result = await saveMessage('testRoom', { text: 'Hello', username: 'user' });
      
      expect(Room.findOneAndUpdate).toHaveBeenCalledWith(
        { roomName: 'testroom' },
        {
          $push: { messages: { text: 'Hello', username: 'user' } },
          $setOnInsert: { roomName: 'testroom' }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );
      
      expect(result).toEqual({ success: true });
    });

    it('should trim and lowercase room name', async () => {
      const mockRoom = { roomName: 'testroom', messages: [] };
      Room.findOneAndUpdate.mockResolvedValue(mockRoom);
      
      await saveMessage('  TestRoom  ', { text: 'Hello' });
      
      expect(Room.findOneAndUpdate).toHaveBeenCalledWith(
        { roomName: 'testroom' },
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('should handle database errors', async () => {
      const errorMessage = 'Database connection failed';
      Room.findOneAndUpdate.mockRejectedValue(new Error(errorMessage));
      
      const result = await saveMessage('testRoom', { text: 'Hello' });
      
      expect(result).toEqual({ error: errorMessage });
    });

    it('should handle duplicate key error with retry', async () => {
      const duplicateError = new Error('Duplicate key');
      duplicateError.code = 11000;
      
      const mockRoom = {
        messages: [],
        save: jest.fn().mockResolvedValue()
      };
      
      Room.findOneAndUpdate
        .mockRejectedValueOnce(duplicateError)
        .mockResolvedValue(mockRoom);
      
      Room.findOne.mockResolvedValue(mockRoom);
      
      const result = await saveMessage('testRoom', { text: 'Hello' });
      
      expect(Room.findOne).toHaveBeenCalledWith({ roomName: 'testroom' });
      expect(mockRoom.save).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });

    it('should handle duplicate key error when room not found', async () => {
      const duplicateError = new Error('Duplicate key');
      duplicateError.code = 11000;
      
      Room.findOneAndUpdate.mockRejectedValue(duplicateError);
      Room.findOne.mockResolvedValue(null);
      
      const result = await saveMessage('testRoom', { text: 'Hello' });
      
      expect(result).toEqual({ 
        error: 'Room not found after duplicate key error. Please try again.' 
      });
    });

    it('should handle retry error in duplicate key handling', async () => {
      const duplicateError = new Error('Duplicate key');
      duplicateError.code = 11000;
      const retryError = new Error('Retry failed');
      
      Room.findOneAndUpdate.mockRejectedValue(duplicateError);
      Room.findOne.mockRejectedValue(retryError);
      
      const result = await saveMessage('testRoom', { text: 'Hello' });
      
      expect(result).toEqual({ error: 'Retry failed' });
    });
  });

  describe('getRoomMessages', () => {
    it('should get messages for existing room', async () => {
      const mockMessages = [
        { text: 'Hello', username: 'user1', createdAt: Date.now() },
        { text: 'World', username: 'user2', createdAt: Date.now() }
      ];
      const mockRoom = { roomName: 'testroom', messages: mockMessages };
      
      Room.findOne.mockResolvedValue(mockRoom);
      
      const result = await getRoomMessages('testRoom');
      
      expect(Room.findOne).toHaveBeenCalledWith({ roomName: 'testroom' });
      expect(result).toEqual({ messages: mockMessages });
    });

    it('should return empty array for non-existent room', async () => {
      Room.findOne.mockResolvedValue(null);
      
      const result = await getRoomMessages('nonExistentRoom');
      
      expect(Room.findOne).toHaveBeenCalledWith({ roomName: 'nonexistentroom' });
      expect(result).toEqual({ messages: [] });
    });

    it('should trim and lowercase room name', async () => {
      Room.findOne.mockResolvedValue(null);
      
      await getRoomMessages('  TestRoom  ');
      
      expect(Room.findOne).toHaveBeenCalledWith({ roomName: 'testroom' });
    });

    it('should handle database errors', async () => {
      const errorMessage = 'Database connection failed';
      Room.findOne.mockRejectedValue(new Error(errorMessage));
      
      const result = await getRoomMessages('testRoom');
      
      expect(result).toEqual({ error: errorMessage });
    });
  });

  describe('deleteOldRooms', () => {
    it('should delete rooms older than 7 days', async () => {
      const mockResult = { deletedCount: 5 };
      Room.deleteMany.mockResolvedValue(mockResult);
      
      const result = await deleteOldRooms();
      
      expect(Room.deleteMany).toHaveBeenCalledWith({
        updatedAt: { $lt: expect.any(Date) }
      });
      
      // Verify the date is approximately 7 days ago
      const calledDate = Room.deleteMany.mock.calls[0][0].updatedAt.$lt;
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - 7);
      
      expect(calledDate.getTime()).toBeCloseTo(expectedDate.getTime(), -10000); // Allow 10 second difference
      
      expect(result).toEqual({ success: true, deletedCount: 5 });
    });

    it('should handle case when no rooms are deleted', async () => {
      const mockResult = { deletedCount: 0 };
      Room.deleteMany.mockResolvedValue(mockResult);
      
      const result = await deleteOldRooms();
      
      expect(result).toEqual({ success: true, deletedCount: 0 });
    });

    it('should handle database errors', async () => {
      const errorMessage = 'Database connection failed';
      Room.deleteMany.mockRejectedValue(new Error(errorMessage));
      
      const result = await deleteOldRooms();
      
      expect(result).toEqual({ error: errorMessage });
    });
  });
});
