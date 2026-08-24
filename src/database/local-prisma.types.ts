import { Prisma } from '../../generated/prisma-local';

/**
 * Client de transação do Prisma para o banco local (SQLite). Usado pelos
 * services que precisam gravar mais de uma tabela atomicamente (ex.:
 * check-in => students + print_jobs + outbox_events).
 */
export type LocalTransactionClient = Prisma.TransactionClient;
