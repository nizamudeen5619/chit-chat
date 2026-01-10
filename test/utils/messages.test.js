const { generateMessage, generateLocationMessage } = require('../../src/utils/messages');

describe('Message Utils', () => {
  describe('generateMessage', () => {
    it('should generate a message with timestamp', () => {
      const username = 'testUser';
      const text = 'Hello World';
      
      const message = generateMessage(username, text);
      
      expect(message).toEqual({
        username: 'testUser',
        text: 'Hello World',
        createdAt: expect.any(Number)
      });
    });

    it('should generate message with current timestamp', () => {
      const beforeTime = Date.now();
      const message = generateMessage('user', 'message');
      const afterTime = Date.now();
      
      expect(message.createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(message.createdAt).toBeLessThanOrEqual(afterTime);
    });

    it('should handle empty username', () => {
      const message = generateMessage('', 'message');
      
      expect(message.username).toBe('');
      expect(message.text).toBe('message');
      expect(message.createdAt).toBeDefined();
    });

    it('should handle empty text', () => {
      const message = generateMessage('user', '');
      
      expect(message.username).toBe('user');
      expect(message.text).toBe('');
      expect(message.createdAt).toBeDefined();
    });
  });

  describe('generateLocationMessage', () => {
    it('should generate a location message with timestamp', () => {
      const username = 'testUser';
      const url = 'https://maps.google.com?q=40.7128,-74.0060';
      
      const message = generateLocationMessage(username, url);
      
      expect(message).toEqual({
        username: 'testUser',
        url: 'https://maps.google.com?q=40.7128,-74.0060',
        createdAt: expect.any(Number)
      });
    });

    it('should generate location message with current timestamp', () => {
      const beforeTime = Date.now();
      const message = generateLocationMessage('user', 'https://example.com');
      const afterTime = Date.now();
      
      expect(message.createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(message.createdAt).toBeLessThanOrEqual(afterTime);
    });

    it('should handle empty username', () => {
      const message = generateLocationMessage('', 'https://example.com');
      
      expect(message.username).toBe('');
      expect(message.url).toBe('https://example.com');
      expect(message.createdAt).toBeDefined();
    });

    it('should handle empty URL', () => {
      const message = generateLocationMessage('user', '');
      
      expect(message.username).toBe('user');
      expect(message.url).toBe('');
      expect(message.createdAt).toBeDefined();
    });

    it('should handle Google Maps URL format', () => {
      const url = 'https://google.com/maps?q=40.7128,-74.0060';
      const message = generateLocationMessage('user', url);
      
      expect(message.url).toBe(url);
      expect(message.username).toBe('user');
      expect(message.createdAt).toBeDefined();
    });
  });
});
