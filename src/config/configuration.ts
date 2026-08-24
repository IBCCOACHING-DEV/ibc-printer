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
  // Banco local (SQLite/WAL) do Checkin Pocket — students, print_jobs,
  // printer_agents, printers, print_job_attempts e outbox_events.
  localDatabase: {
    url: process.env.LOCAL_DATABASE_URL || 'file:./data/checkin-pocket.db',
  },
  // Mensageria com o Checkin Pai e com as demais estações via RabbitMQ.
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
  },
  // Identidade desta estação de credenciamento (usada como agentKey nas
  // filas/eventos do RabbitMQ e no inventário local de impressoras).
  checkinAgent: {
    agentKey: process.env.CHECKIN_AGENT_KEY || 'local-agent',
    agentName: process.env.CHECKIN_AGENT_NAME || 'Checkin Pocket',
  },
  // Banco MySQL PRINCIPAL do Checkin Pai ("checkin") — acesso SOMENTE
  // LEITURA usado para sincronizar auth (users) e listar/baixar
  // Courses/Students sob demanda. Nunca usado para migrate/escrita.
  paiDatabase: {
    host: process.env.PAI_DATABASE_HOST,
    port: parseInt(process.env.PAI_DATABASE_PORT, 10) || 3306,
    name: process.env.PAI_DATABASE_NAME,
    user: process.env.PAI_DATABASE_USER,
    password: process.env.PAI_DATABASE_PASSWORD,
  },
  // Sincronização de autenticação (cache local de Operator) a partir do
  // banco do Pai — roda em loop de retry no boot e depois periodicamente.
  authSync: {
    retryIntervalMs: parseInt(process.env.AUTH_SYNC_RETRY_INTERVAL_MS, 10) || 15000,
    refreshIntervalMs:
      parseInt(process.env.AUTH_SYNC_REFRESH_INTERVAL_MS, 10) || 300000,
  },
});
