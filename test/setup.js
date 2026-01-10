// Test setup file for Jest
// This file runs before each test file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';

// Mock MongoDB connection for tests
jest.mock('../src/db/mongoose', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(true)
}));

// Global test timeout
jest.setTimeout(10000);
