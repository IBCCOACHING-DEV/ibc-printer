import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { RabbitMqService } from '../messaging/rabbitmq.service';
import { CHECKIN_EVENTS_EXCHANGE } from '../messaging/rabbitmq.constants';
import { OutboxService } from './outbox.service';
import { OutboxEvent } from '../../generated/prisma-local';

const WORKER_TICK_MS = 3000;
const BATCH_SIZE = 20;

/**
 * Worker/cron do NestJS responsável por drenar a tabela `outbox_events` e
 * publicar cada evento no RabbitMQ. Um evento só é removido do SQLite
 * depois que o broker confirma o recebimento (ACK via confirm channel);
 * caso contrário permanece marcado como `failed` para nova tentativa no
 * próximo tick.
 */
@Injectable()
export class OutboxPublisherWorker {
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private running = false;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly rabbitMq: RabbitMqService,
  ) {}

  @Interval(WORKER_TICK_MS)
  async handleTick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      await this.dispatchPendingEvents();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha no ciclo do worker de outbox: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async dispatchPendingEvents(): Promise<void> {
    const events = await this.outboxService.findDispatchable(BATCH_SIZE);

    for (const event of events) {
      // Isola cada evento: uma falha inesperada em um não deve impedir a
      // tentativa dos demais eventos do lote.
      try {
        await this.dispatchEvent(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Falha inesperada ao despachar o evento de outbox ${event.id}: ${message}`);
      }
    }
  }

  private async dispatchEvent(event: OutboxEvent): Promise<void> {
    let payload: object;

    try {
      payload = JSON.parse(event.payload) as object;
    } catch {
      await this.outboxService.markFailed(
        event.id,
        event.attempts + 1,
        'Payload inválido (JSON malformado) — evento não pode ser publicado.',
      );
      return;
    }

    const published = await this.rabbitMq.publish(CHECKIN_EVENTS_EXCHANGE, event.routingKey, payload);

    if (published) {
      await this.outboxService.markPublished(event.id);
      this.logger.log(`Evento de outbox ${event.id} (${event.eventType}) publicado e removido (ACK recebido).`);
      return;
    }

    await this.outboxService.markFailed(
      event.id,
      event.attempts + 1,
      'Broker RabbitMQ não confirmou o recebimento (nack/timeout/indisponível).',
    );
  }
}
