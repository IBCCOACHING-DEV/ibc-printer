import { Global, Module } from '@nestjs/common';
import { LocalPrismaService } from './local-prisma.service';
import { RemotePaiPrismaService } from './remote-prisma.service';

/**
 * Módulo global de acesso a banco. É importado uma única vez em AppModule e
 * expõe, via injeção de dependência, os dois clients Prisma do Checkin
 * Pocket:
 *
 *  - LocalPrismaService: SQLite local (WAL) — leitura e escrita.
 *  - RemotePaiPrismaService: MySQL do Checkin Pai — SOMENTE LEITURA, conexão
 *    lazy que nunca bloqueia o boot (ver comentário no próprio serviço).
 */
@Global()
@Module({
  providers: [LocalPrismaService, RemotePaiPrismaService],
  exports: [LocalPrismaService, RemotePaiPrismaService],
})
export class DatabaseModule {}
