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
  printerHub: {
    enabled: process.env.PRINTER_HUB_ENABLED === 'true',
    baseUrl: process.env.PRINTER_HUB_BASE_URL || '',
    apiToken: process.env.PRINTER_HUB_API_TOKEN || '',
    eventId: process.env.PRINTER_HUB_EVENT_ID || 'default-event',
    agentKey: process.env.PRINTER_AGENT_KEY || '',
    agentName: process.env.PRINTER_AGENT_NAME || '',
    uidPrefix: process.env.PRINTER_UID_PREFIX || '',
    heartbeatIntervalMs:
      parseInt(process.env.PRINTER_HEARTBEAT_INTERVAL_MS, 10) || 30000,
    claimIntervalMs:
      parseInt(process.env.PRINTER_CLAIM_INTERVAL_MS, 10) || 1500,
    claimBatchSize:
      parseInt(process.env.PRINTER_CLAIM_BATCH_SIZE, 10) || 1,
  },
});
