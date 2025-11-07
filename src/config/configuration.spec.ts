import configuration from './configuration';

describe('Configuration', () => {
  it('should return default configuration', () => {
    process.env.PORT = '3000';
    process.env.JWT_SECRET = 'test-secret';

    const config = configuration();

    expect(config.port).toBe(3000);
    expect(config.jwt.secret).toBe('test-secret');
    expect(config.jwt.expiresIn).toBe('1h');
    expect(config.print.timeout).toBe(30000);
  });

  it('should use default values when env vars are missing', () => {
    delete process.env.PORT;
    delete process.env.JWT_SECRET;

    const config = configuration();

    expect(config.port).toBe(3000);
    expect(config.jwt.secret).toBe('default-secret-key');
  });
});
