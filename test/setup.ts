import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const originalConsoleLog = console.log;
const originalConsoleError = console.error;

beforeAll(() => {
  console.log = jest.fn();
  console.error = jest.fn();

  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6379';
  process.env.DEFAULT_PRINTER = 'test-printer';
});

afterAll(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});
