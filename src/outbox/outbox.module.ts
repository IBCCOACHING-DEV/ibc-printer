import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxPublisherWorker } from './outbox-publisher.worker';

@Module({
  providers: [OutboxService, OutboxPublisherWorker],
  exports: [OutboxService],
})
export class OutboxModule {}
