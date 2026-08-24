import { Injectable, Logger } from '@nestjs/common';
import { LocalPrismaService } from '../database/local-prisma.service';
import { LocalTransactionClient } from '../database/local-prisma.types';
import { OutboxEvent } from '../../generated/prisma-local';

export interface RecordEventParams {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  routingKey: string;
  payload: object;
}

const MAX_OUTBOX_ATTEMPTS_BEFORE_ALERT = 10;

/**
 * Implementação do Outbox Pattern para o Checkin Pocket: eventos de domínio
 * são gravados na tabela local `outbox_events`, na MESMA transação SQLite
 * da mudança de estado (ex.: check-in). Um worker separado (ver
 * `OutboxPublisherWorker`) tenta publicar cada evento no RabbitMQ; a linha
 * só é removida após o ACK do broker.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: LocalPrismaService) {}

  record(tx: LocalTransactionClient, params: RecordEventParams): Promise<OutboxEvent> {
    return tx.outboxEvent.create({
      data: {
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        eventType: params.eventType,
        routingKey: params.routingKey,
        payload: JSON.stringify(params.payload),
      },
    });
  }

  findDispatchable(limit: number): Promise<OutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: { status: { in: ['pending', 'failed'] } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Remove o evento após confirmação (ACK) do broker RabbitMQ — é assim
   * que o outbox "esvazia" e nunca reenviamos um evento já publicado.
   */
  async markPublished(id: string): Promise<void> {
    await this.prisma.outboxEvent.delete({ where: { id } });
  }

  async markFailed(id: string, attempts: number, lastError: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'failed', attempts, lastError },
    });

    if (attempts >= MAX_OUTBOX_ATTEMPTS_BEFORE_ALERT) {
      this.logger.error(
        `Evento de outbox ${id} falhou ${attempts} vezes consecutivas ao tentar publicar no RabbitMQ.`,
      );
    }
  }
}
