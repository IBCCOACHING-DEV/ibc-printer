import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import { PrintPdfDto } from '../print/dto/print-pdf.dto';
import { PrintTextDto } from '../print/dto/print-text.dto';

export interface PrintJobData {
  type: 'pdf' | 'text';
  data: PrintPdfDto | PrintTextDto;
  requestId: string;
  timestamp: Date;
}

export interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(@InjectQueue('print') private printQueue: Queue) {}

  async addPdfJob(
    printDto: PrintPdfDto,
  ): Promise<{ jobId: string; requestId: string }> {
    const requestId = uuidv4();

    const job = await this.printQueue.add(
      'pdf',
      {
        type: 'pdf',
        data: printDto,
        requestId,
        timestamp: new Date(),
      } as PrintJobData,
      {
        jobId: requestId,
      },
    );

    this.logger.log(
      `PDF job adicionado à fila - Request: ${requestId}, Job: ${job.id}`,
    );
    return { jobId: job.id.toString(), requestId };
  }

  async addTextJob(
    printDto: PrintTextDto,
  ): Promise<{ jobId: string; requestId: string }> {
    const requestId = uuidv4();

    const job = await this.printQueue.add(
      'text',
      {
        type: 'text',
        data: printDto,
        requestId,
        timestamp: new Date(),
      } as PrintJobData,
      {
        jobId: requestId,
      },
    );

    this.logger.log(
      `Text job adicionado à fila - Request: ${requestId}, Job: ${job.id}`,
    );
    return { jobId: job.id.toString(), requestId };
  }

  async getQueueStatus(): Promise<QueueStatus> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.printQueue.getWaiting(),
      this.printQueue.getActive(),
      this.printQueue.getCompleted(),
      this.printQueue.getFailed(),
      this.printQueue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }

  async getJobStatus(jobId: string) {
    const job = await this.printQueue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();
    const result = await job.finished().catch(() => null);

    return {
      id: job.id,
      state,
      progress: job.progress(),
      result,
      failedReason: job.failedReason,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  async cleanQueue(grace: number = 1000): Promise<void> {
    await this.printQueue.clean(3600000, 'completed');

    await this.printQueue.clean(86400000, 'failed');

    this.logger.log('Fila limpa com sucesso');
  }
}
