export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  print: {
    defaultPrinter: process.env.DEFAULT_PRINTER,
    timeout: parseInt(process.env.PRINT_TIMEOUT, 10) || 30000,
  },
});
