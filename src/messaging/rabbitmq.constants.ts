// Topologia RabbitMQ do Checkin Pocket.
//
// Exchange topic `ibc.checkin.events`: toda instância do Checkin Pocket
// publica aqui quando realiza um check-in local (via Outbox worker). Cada
// instância também declara sua PRÓPRIA fila (uma por agente) ligada a esta
// exchange, para que todas as instâncias recebam uma cópia de todo evento
// publicado por qualquer computador da rede (fan-out via topic exchange).
export const CHECKIN_EVENTS_EXCHANGE = 'ibc.checkin.events';
export const CHECKIN_EVENTS_EXCHANGE_DLX = 'ibc.checkin.events.dlx';

export const CHECKIN_PERFORMED_ROUTING_KEY = 'checkin.performed';
export const CHECKIN_PERFORMED_BINDING_PATTERN = 'checkin.#';
export const CHECKIN_PERFORMED_DEAD_ROUTING_KEY = 'checkin.performed.dead';

// Dead-letter exchange/queue para print_jobs que esgotaram as tentativas
// locais de impressão (tolerância a falhas do fluxo de impressão).
export const PRINT_JOBS_DLX_EXCHANGE = 'ibc.print.dlx';
export const PRINT_JOB_FAILED_ROUTING_KEY = 'print.failed';
export const PRINT_JOBS_DLQ_QUEUE = 'ibc.print.dead-letters';

export function checkinSyncQueueName(agentKey: string): string {
  return `checkin.sync.${agentKey}`;
}

export function checkinSyncDeadLetterQueueName(agentKey: string): string {
  return `${checkinSyncQueueName(agentKey)}.dlq`;
}
