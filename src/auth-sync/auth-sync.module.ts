import { Module } from '@nestjs/common';
import { AuthSyncService } from './auth-sync.service';

/**
 * Sincronização de autenticação: mantém o cache local de operadores
 * (tabela `operators`, SQLite) em dia a partir do banco do Checkin Pai.
 * Ver AuthSyncService para o comportamento de retry no boot + refresh
 * periódico.
 */
@Module({
  providers: [AuthSyncService],
  exports: [AuthSyncService],
})
export class AuthSyncModule {}
