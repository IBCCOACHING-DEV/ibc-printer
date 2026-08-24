/**
 * Estado observável da sincronização de auth (cache local de Operator a
 * partir do banco do Checkin Pai). Combina diagnóstico da SESSÃO atual
 * (em memória, reinicia a cada boot) com fatos persistidos no SQLite
 * local (sobrevivem a reinícios) — assim a estação nunca fica "sem
 * resposta" sobre o estado da sincronização, mesmo logo após ligar e
 * antes de qualquer tentativa desta sessão terminar.
 */
export interface AuthSyncStatus {
  /** true assim que ESTA sessão do processo conseguiu sincronizar ao menos uma vez (false não significa "nunca sincronizou" — ver lastSuccessAt/cachedOperatorsCount). */
  hasSyncedThisSession: boolean;
  lastAttemptAt: Date | null;
  /** Erro da última tentativa desta sessão (null se a última tentativa teve sucesso ou nenhuma ocorreu ainda). */
  lastError: string | null;
  /**
   * Data/hora da última sincronização bem-sucedida desta estação, calculada
   * a partir do cache local (`MAX(operators.synced_at)`) — não depende de
   * memória, então reflete a verdade mesmo antes da primeira tentativa
   * desta sessão terminar.
   */
  lastSuccessAt: Date | null;
  /** Quantos operadores estão no cache local AGORA — > 0 significa que o login funciona mesmo sem rede. */
  cachedOperatorsCount: number;
}
