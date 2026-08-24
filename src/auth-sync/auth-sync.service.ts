import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalPrismaService } from '../database/local-prisma.service';
import { RemotePaiPrismaService } from '../database/remote-prisma.service';
import { User as RemoteUser } from '../../generated/prisma-remote/client';
import { AuthSyncStatus } from './auth-sync.types';

const DEFAULT_RETRY_INTERVAL_MS = 15000;
const DEFAULT_REFRESH_INTERVAL_MS = 300000;

/**
 * Mantém o cache local de operadores (tabela `operators`, SQLite) em dia a
 * partir do banco do Checkin Pai (MySQL, tabela `users`).
 *
 * Requisito do usuário: "o Pocket sempre vai buscar no banco de dados do
 * pai a informação de auth (sempre que inicializar, com repeat ou try
 * validando quando tem rede, até conseguir)". Por isso este serviço:
 *
 *  1. Ao iniciar (onModuleInit), dispara um loop de sincronização em
 *     BACKGROUND — SEM aguardar a Promise — para que o boot do NestJS
 *     nunca trave esperando o banco do Pai (rede instável/IP mutável são
 *     esperados nos eventos itinerantes).
 *  2. Enquanto não conseguir a primeira sincronização, tenta de novo a
 *     cada `authSync.retryIntervalMs`.
 *  3. Depois da primeira sincronização bem-sucedida, passa a repetir a
 *     cada `authSync.refreshIntervalMs` (mantém o cache atualizado caso o
 *     operador troque de senha, seja criado/desativado, etc.).
 *
 * O login (ver AuthService, tarefa futura) sempre consulta apenas o cache
 * local (`Operator`), nunca o banco do Pai diretamente — assim o
 * credenciamento continua funcionando mesmo se a rede cair depois do boot.
 */
@Injectable()
export class AuthSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthSyncService.name);

  private stopped = false;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Diagnóstico da sessão ATUAL (em memória — reinicia a cada boot). O
   * estado "de verdade" (lastSuccessAt/cachedOperatorsCount) é sempre lido
   * do SQLite local em getStatus(), nunca só da memória — ver comentário
   * da classe e de AuthSyncStatus. */
  private sessionState = {
    hasSyncedThisSession: false,
    lastAttemptAt: null as Date | null,
    lastError: null as string | null,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly localPrisma: LocalPrismaService,
    private readonly remotePrisma: RemotePaiPrismaService,
  ) {}

  onModuleInit(): void {
    // Fire-and-forget deliberado: NÃO retornamos/aguardamos esta Promise
    // para não bloquear o bootstrap do Nest enquanto o banco do Pai
    // estiver inacessível.
    void this.runSyncLoop();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
  }

  /**
   * Combina o diagnóstico em memória desta sessão com fatos persistidos no
   * SQLite local (`MAX(operators.synced_at)` e contagem de operadores em
   * cache) — assim a estação sempre tem uma resposta correta sobre "última
   * sincronização" mesmo antes da primeira tentativa desta sessão
   * terminar, ou se o processo acabou de reiniciar sem rede disponível.
   */
  async getStatus(): Promise<AuthSyncStatus> {
    const [cachedOperatorsCount, mostRecentlySynced] = await Promise.all([
      this.localPrisma.operator.count(),
      this.localPrisma.operator.findFirst({
        orderBy: { syncedAt: 'desc' },
        select: { syncedAt: true },
      }),
    ]);

    return {
      hasSyncedThisSession: this.sessionState.hasSyncedThisSession,
      lastAttemptAt: this.sessionState.lastAttemptAt,
      lastError: this.sessionState.lastError,
      lastSuccessAt: mostRecentlySynced?.syncedAt ?? null,
      cachedOperatorsCount,
    };
  }

  /**
   * Força uma tentativa de sincronização imediata (fora do ritmo normal do
   * loop), sem interferir no agendamento em curso. Pensada para uso futuro
   * em um botão "sincronizar auth" no front-end.
   */
  async forceSync(): Promise<boolean> {
    return this.attemptSync();
  }

  private async runSyncLoop(): Promise<void> {
    while (!this.stopped) {
      const success = await this.attemptSync();

      if (this.stopped) {
        return;
      }

      const delayMs = success ? this.refreshIntervalMs() : this.retryIntervalMs();
      await this.sleep(delayMs);
    }
  }

  private async attemptSync(): Promise<boolean> {
    this.sessionState.lastAttemptAt = new Date();

    const reachable = await this.remotePrisma.ping();
    if (!reachable) {
      this.sessionState.lastError =
        'Banco do Pai inacessível (rede instável ou indisponível). Estação segue operando com o último cache sincronizado.';
      this.logger.warn(
        `Sincronização de auth adiada: banco do Pai inacessível. Nova tentativa em ${this.retryIntervalMs()}ms.`,
      );
      return false;
    }

    try {
      const users = await this.remotePrisma.client.user.findMany();
      const synced = await this.upsertOperators(users);

      this.sessionState.hasSyncedThisSession = true;
      this.sessionState.lastError = null;

      this.logger.log(`Sincronização de auth concluída: ${synced}/${users.length} operador(es) atualizados.`);
      return true;
    } catch (error) {
      const message = this.describeError(error);
      this.sessionState.lastError = message;
      this.logger.error(`Falha ao sincronizar auth com o banco do Pai: ${message}`);
      return false;
    }
  }

  /**
   * Faz upsert de cada usuário isoladamente: um registro problemático (ex.:
   * e-mail duplicado por alguma inconsistência no Pai) não pode abortar a
   * sincronização dos demais operadores.
   */
  private async upsertOperators(users: RemoteUser[]): Promise<number> {
    const now = new Date();
    let synced = 0;

    for (const user of users) {
      try {
        await this.localPrisma.operator.upsert({
          where: { remoteUserId: user.id },
          create: {
            remoteUserId: user.id,
            email: user.email,
            passwordHash: user.encryptedPassword,
            name: user.name,
            status: user.status,
            courseType: user.courseType,
            authenticationToken: user.authenticationToken ?? null,
            syncedAt: now,
          },
          update: {
            email: user.email,
            passwordHash: user.encryptedPassword,
            name: user.name,
            status: user.status,
            courseType: user.courseType,
            authenticationToken: user.authenticationToken ?? null,
            syncedAt: now,
          },
        });
        synced += 1;
      } catch (error) {
        this.logger.error(
          `Falha ao sincronizar o operador remoteUserId=${user.id} (${user.email}): ${this.describeError(error)}`,
        );
      }
    }

    return synced;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pendingTimeout = setTimeout(() => {
        this.pendingTimeout = null;
        resolve();
      }, ms);
    });
  }

  private retryIntervalMs(): number {
    return (
      this.configService.get<number>('authSync.retryIntervalMs') ?? DEFAULT_RETRY_INTERVAL_MS
    );
  }

  private refreshIntervalMs(): number {
    return (
      this.configService.get<number>('authSync.refreshIntervalMs') ?? DEFAULT_REFRESH_INTERVAL_MS
    );
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
