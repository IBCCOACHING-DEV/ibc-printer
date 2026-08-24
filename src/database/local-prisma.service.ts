import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '../../generated/prisma-local';

const DEFAULT_LOCAL_DATABASE_URL = 'file:./data/checkin-pocket.db';

/**
 * Wrapper de injeção de dependência do NestJS em torno do PrismaClient do
 * banco LOCAL (SQLite) do Checkin Pocket.
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

  async onModuleInit(): Promise<void> {
    this.ensureDatabaseDirectoryExists();
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

  private get databaseUrl(): string {
    return process.env.LOCAL_DATABASE_URL ?? DEFAULT_LOCAL_DATABASE_URL;
  }

  /**
   * O driver SQLite não cria diretórios intermediários sozinho — se
   * `LOCAL_DATABASE_URL` apontar para `./data/checkin-pocket.db` e a pasta
   * `data/` não existir, a conexão falha. Garantimos a pasta aqui.
   */
  private ensureDatabaseDirectoryExists(): void {
    const url = this.databaseUrl;
    if (!url.startsWith('file:')) {
      return;
    }

    const filePath = url.replace(/^file:/, '');
    const directory = dirname(filePath);

    if (directory && directory !== '.') {
      mkdirSync(directory, { recursive: true });
    }
  }
}
