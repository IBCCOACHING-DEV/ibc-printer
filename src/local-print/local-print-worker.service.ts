import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PrintService } from '../print/print.service';
import { RabbitMqService } from '../messaging/rabbitmq.service';
import { PrintJobDeadLetterMessage } from '../messaging/types';
import { PRINT_JOBS_DLX_EXCHANGE, PRINT_JOB_FAILED_ROUTING_KEY } from '../messaging/rabbitmq.constants';
import { LocalPrintJobsService } from './local-print-jobs.service';
import { PrintJob } from '../../generated/prisma-local';

const WORKER_TICK_MS = 2000;
const BATCH_SIZE = 5;
const RETRY_BACKOFF_BASE_MS = 3000;

/**
 * Worker local que efetivamente imprime as etiquetas criadas em
 * `print_jobs`. Roda de forma assíncrona e desacoplada da requisição de
 * check-in — o endpoint de check-in só cria o registro `pending`.
 *
 * Tolerância a falhas: cada job tem `max_attempts`. Ao esgotar as
 * tentativas, o job é marcado `dead` e uma mensagem é publicada na
 * dead-letter exchange do RabbitMQ (`ibc.print.dlx`), evitando travar o
 * processamento dos próximos jobs pendentes.
 */
@Injectable()
export class LocalPrintWorkerService {
  private readonly logger = new Logger(LocalPrintWorkerService.name);
  private running = false;

  constructor(
    private readonly printJobsService: LocalPrintJobsService,
    private readonly printService: PrintService,
    private readonly rabbitMq: RabbitMqService,
    private readonly configService: ConfigService,
  ) {}

  @Interval(WORKER_TICK_MS)
  async handleTick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    try {
      await this.processPendingJobs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha no ciclo do worker de impressão local: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async processPendingJobs(): Promise<void> {
    const candidates = await this.printJobsService.findPendingBatch(20);
    const now = Date.now();

    const dueJobs = candidates.filter((job) => {
      const backoffMs = job.attemptCount * RETRY_BACKOFF_BASE_MS;
      return now - job.updatedAt.getTime() >= backoffMs;
    });

    for (const job of dueJobs.slice(0, BATCH_SIZE)) {
      // Isola cada job: uma falha inesperada em um não deve impedir a
      // tentativa dos demais jobs pendentes deste ciclo.
      try {
        await this.processJob(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Falha inesperada ao processar print_job=${job.id}: ${message}`);
      }
    }
  }

  private async processJob(job: PrintJob): Promise<void> {
    const startedAt = new Date();

    const result = await this.printService.printText({
      name: job.labelName,
      nickname: job.labelName,
      course: job.labelCourseName,
      printerName: job.targetPrinterUid,
      copies: 1,
    });

    const finishedAt = new Date();

    await this.printJobsService.recordAttempt(job.id, {
      startedAt,
      finishedAt,
      success: result.success,
      errorCode: result.success ? undefined : 'PRINT_ERROR',
      errorMessage: result.success ? undefined : result.error,
    });

    if (result.success) {
      await this.printJobsService.markSucceeded(job.id, JSON.stringify(result));
      this.logger.log(`Etiqueta impressa com sucesso — print_job=${job.id}, aluno=${job.studentId}.`);
      return;
    }

    const attemptCount = job.attemptCount + 1;

    if (attemptCount >= job.maxAttempts) {
      await this.printJobsService.markDead(job.id, attemptCount, JSON.stringify(result));
      this.logger.error(
        `print_job=${job.id} esgotou ${attemptCount}/${job.maxAttempts} tentativas. Enviando para a DLQ de impressão.`,
      );
      await this.sendToDeadLetter(job, attemptCount, result.error);
      return;
    }

    await this.printJobsService.markRetry(job.id, attemptCount);
    this.logger.warn(
      `print_job=${job.id} falhou (tentativa ${attemptCount}/${job.maxAttempts}). Novo retry será agendado.`,
    );
  }

  private async sendToDeadLetter(job: PrintJob, attemptCount: number, lastError?: string): Promise<void> {
    const message: PrintJobDeadLetterMessage = {
      printJobId: job.id,
      studentId: job.studentId,
      targetPrinterUid: job.targetPrinterUid,
      attemptCount,
      maxAttempts: job.maxAttempts,
      lastError: lastError ?? null,
      sourceAgentKey: this.configService.get<string>('checkinAgent.agentKey', 'unknown-agent'),
      occurredAt: new Date().toISOString(),
    };

    const published = await this.rabbitMq.publish(
      PRINT_JOBS_DLX_EXCHANGE,
      PRINT_JOB_FAILED_ROUTING_KEY,
      message,
    );

    if (!published) {
      this.logger.error(
        `Não foi possível publicar o print_job=${job.id} na dead-letter exchange (broker indisponível).`,
      );
    }
  }
}
