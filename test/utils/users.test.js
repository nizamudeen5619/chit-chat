const { addUser, removeUser, getUser, getUsersInRoom, users } = require('../../src/utils/users');

describe('User Utils', () => {
  beforeEach(() => {
    // Clear the users array before each test
    users.length = 0;
  });

  describe('addUser', () => {
    it('should add a new user successfully', () => {
      const result = addUser({ id: '1', username: 'testUser', room: 'testRoom' });
      
      expect(result.user).toEqual({
        id: '1',
        username: 'testUser',
        room: 'testroom'
      });
      expect(result.error).toBeUndefined();
    });

    it('should return error when username is missing', () => {
      const result = addUser({ id: '1', room: 'testRoom' });
      
      expect(result.error).toBe('Username and room are required');
      expect(result.user).toBeUndefined();
    });

    it('should return error when room is missing', () => {
      const result = addUser({ id: '1', username: 'testUser' });
      
      expect(result.error).toBe('Username and room are required');
      expect(result.user).toBeUndefined();
    });

    it('should trim whitespace from username and room', () => {
      const result = addUser({ id: '1', username: '  testUser  ', room: '  testRoom  ' });
      
      expect(result.user).toEqual({
        id: '1',
        username: 'testUser',
        room: 'testroom'
      });
    });

    it('should return error when username already exists in room (case-insensitive)', () => {
      addUser({ id: '1', username: 'testUser', room: 'testRoom' });
      
      const result = addUser({ id: '2', username: 'TestUser', room: 'testRoom' });
      
      expect(result.error).toBe('Username already taken');
      expect(result.user).toBeUndefined();
    });

    it('should allow same username in different rooms', () => {
      addUser({ id: '1', username: 'testUser', room: 'room1' });
      
      const result = addUser({ id: '2', username: 'testUser', room: 'room2' });
      
      expect(result.user).toEqual({
        id: '2',
        username: 'testUser',
        room: 'room2'
      });
      expect(result.error).toBeUndefined();
    });
  });

  describe('removeUser', () => {
    it('should remove user and return user object', () => {
      addUser({ id: '1', username: 'testUser', room: 'testRoom' });
      
      const removedUser = removeUser('1');
      
      expect(removedUser).toEqual({
        id: '1',
        username: 'testUser',
        room: 'testroom'
      });
      expect(getUser('1')).toBeUndefined();
    });

    it('should return undefined when user not found', () => {
      const removedUser = removeUser('nonexistent');
      
      expect(removedUser).toBeUndefined();
    });
  });

  describe('getUser', () => {
    it('should return user when found', () => {
      addUser({ id: '1', username: 'testUser', room: 'testRoom' });
      
      const user = getUser('1');
      
      expect(user).toEqual({
        id: '1',
        username: 'testUser',
        room: 'testroom'
      });
    });

    it('should return undefined when user not found', () => {
      const user = getUser('nonexistent');
      
      expect(user).toBeUndefined();
    });
  });

  describe('getUsersInRoom', () => {
    it('should return users in specific room', () => {
      addUser({ id: '1', username: 'user1', room: 'room1' });
      addUser({ id: '2', username: 'user2', room: 'room1' });
      addUser({ id: '3', username: 'user3', room: 'room2' });
      
      const usersInRoom1 = getUsersInRoom('room1');
      
      expect(usersInRoom1).toHaveLength(2);
      expect(usersInRoom1.map(u => u.username)).toEqual(['user1', 'user2']);
    });

    it('should return empty array when no users in room', () => {
      const usersInRoom = getUsersInRoom('emptyRoom');
      
      expect(usersInRoom).toEqual([]);
    });

    it('should handle undefined room safely', () => {
      const usersInRoom = getUsersInRoom(undefined);
      
      expect(usersInRoom).toEqual([]);
    });

    it('should handle null room safely', () => {
      const usersInRoom = getUsersInRoom(null);
      
      expect(usersInRoom).toEqual([]);
    });

    it('should handle non-string room safely', () => {
      const usersInRoom = getUsersInRoom(123);
      
      expect(usersInRoom).toEqual([]);
    });

    it('should trim and lowercase room name', () => {
      addUser({ id: '1', username: 'user1', room: 'room1' });
      
      const usersInRoom = getUsersInRoom('  Room1  ');
      
      expect(usersInRoom).toHaveLength(1);
      expect(usersInRoom[0].username).toBe('user1');
    });
  });
});
