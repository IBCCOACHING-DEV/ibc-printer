import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../../generated/prisma-local';

const DEFAULT_LOCAL_DATABASE_URL = 'file:./data/checkin-pocket.db';

function resolveDatabaseUrl(): string {
  return process.env.LOCAL_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;
}

/**
 * O driver SQLite não cria diretórios intermediários sozinho — se
 * `LOCAL_DATABASE_URL` apontar para `./data/checkin-pocket.db` e a pasta
 * `data/` não existir, a conexão falha. Precisa rodar ANTES de instanciar o
 * adapter (que já abre o arquivo do banco na construção), por isso é
 * chamada antes do `super()`.
 */
function ensureDatabaseDirectoryExists(url: string): void {
  if (!url.startsWith('file:')) {
    return;
  }

  const filePath = url.replace(/^file:/, '');
  const directory = dirname(filePath);

  if (directory && directory !== '.') {
    mkdirSync(directory, { recursive: true });
  }
}

/**
 * Wrapper de injeção de dependência do NestJS em torno do PrismaClient do
 * banco LOCAL (SQLite) do Checkin Pocket.
 *
 * Prisma 7 exige um driver adapter explícito (ver [[RemotePaiPrismaService]]
 * para o equivalente MySQL) — aqui usamos `@prisma/adapter-better-sqlite3`.
 *
 * Habilita o modo WAL (Write-Ahead Logging) na conexão para permitir
 * leituras concorrentes enquanto o worker de outbox/impressão grava,
 * conforme exigido pelas regras do Checkin Pocket.
 */
@Injectable()
export class LocalPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(LocalPrismaService.name);
  private readonly databaseUrl: string;

  constructor() {
    const databaseUrl = resolveDatabaseUrl();
    ensureDatabaseDirectoryExists(databaseUrl);

    super({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });

    this.databaseUrl = databaseUrl;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    // SQLite não aceita bind params em PRAGMA; os valores abaixo são
    // constantes fixas definidas por este código, não input do usuário.
    await this.$executeRawUnsafe('PRAGMA journal_mode = WAL;');
    await this.$executeRawUnsafe('PRAGMA foreign_keys = ON;');
    await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000;');

    this.logger.log(`Banco local (SQLite, WAL) conectado em ${this.databaseUrl}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
