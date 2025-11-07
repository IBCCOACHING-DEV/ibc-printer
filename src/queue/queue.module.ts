import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrintModule } from '../print/print.module';
import { PrintProcessor } from './processors/print.processor';
import { QueueService } from './queue.service';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'print',
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        timeout: 30000,
      },
    }),
    forwardRef(() => PrintModule),
  ],
  providers: [PrintProcessor, QueueService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
