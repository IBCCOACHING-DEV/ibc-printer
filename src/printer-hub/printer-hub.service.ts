import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'os';
import { PrintService } from '../print/print.service';
import prisma from '../lib/prisma';

interface HubJob {
  job_id: string;
  mode: 'temporary' | 'queue';
  target_printer_uid: string;
  payload: any;
  idempotency_key: string;
}

@Injectable()
export class PrinterHubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrinterHubService.name);
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private claimTimer: NodeJS.Timeout | null = null;
  private isClaiming = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly printService: PrintService,
  ) {}

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Printer hub integration disabled by config');
      return;
    }

    await this.safeRegister();
    await this.safeHeartbeat();
    this.startLoops();
  }

  onModuleDestroy() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.claimTimer) {
      clearInterval(this.claimTimer);
      this.claimTimer = null;
    }
  }

  private startLoops() {
    const heartbeatMs = this.configService.get<number>(
      'printerHub.heartbeatIntervalMs',
      30000,
    );
    const claimMs = this.configService.get<number>(
      'printerHub.claimIntervalMs',
      1500,
    );

    this.heartbeatTimer = setInterval(() => {
      this.safeHeartbeat().catch((error) => {
        this.logger.error(`Heartbeat loop failed: ${error?.message}`);
      });
    }, heartbeatMs);

    this.claimTimer = setInterval(() => {
      this.safeClaimAndProcess().catch((error) => {
        this.logger.error(`Claim loop failed: ${error?.message}`);
      });
    }, claimMs);

    this.logger.log(
      `Printer hub loops started (heartbeat=${heartbeatMs}ms, claim=${claimMs}ms)`,
    );
  }

  private get enabled(): boolean {
    return this.configService.get<boolean>('printerHub.enabled', false);
  }

  private get baseUrl(): string {
    const base = this.configService
      .get<string>('printerHub.baseUrl', '')
      .trim();
    return base.replace(/\/$/, '');
  }

  private get eventId(): string {
    return this.configService.get<string>(
      'printerHub.eventId',
      'default-event',
    );
  }

  private get agentKey(): string {
    return this.configService.get<string>('printerHub.agentKey', hostname());
  }

  private get agentName(): string {
    return this.configService.get<string>(
      'printerHub.agentName',
      `ibc-printer-${hostname()}`,
    );
  }

  private get apiToken(): string {
    return this.configService.get<string>('printerHub.apiToken', '');
  }

  private get claimBatchSize(): number {
    const raw = this.configService.get<number>('printerHub.claimBatchSize', 1);
    if (raw <= 0) {
      return 1;
    }

    return Math.min(raw, 20);
  }

  private async safeRegister() {
    try {
      if (!this.baseUrl || !this.apiToken) {
        this.logger.warn(
          'Printer hub missing baseUrl or apiToken, skipping register',
        );
        return;
      }

      await this.post('/agents/register', {
        event_id: this.eventId,
        agent_key: this.agentKey,
        name: this.agentName,
        version: process.env.npm_package_version || 'local',
        metadata: {
          os: process.platform,
          arch: process.arch,
          hostname: hostname(),
          node: process.version,
        },
      });

      this.logger.log('Agent register/upsert sent to printer hub');
    } catch (error) {
      this.logger.error(`Register failed: ${this.errorMessage(error)}`);
    }
  }

  private async safeHeartbeat() {
    try {
      if (!this.baseUrl || !this.apiToken) {
        return;
      }

      const printers = await this.printService.getPrinters();
      const payload = {
        event_id: this.eventId,
        agent_key: this.agentKey,
        version: process.env.npm_package_version || 'local',
        metadata: {
          os: process.platform,
          arch: process.arch,
          hostname: hostname(),
        },
        health: 'healthy',
        printers: printers.map((printer) => ({
          printer_uid: this.buildPrinterUid(printer.name),
          name: printer.name,
          is_default: !!printer.isDefault,
          is_online: printer.isOnline !== false,
          capabilities: {
            status: printer.status,
            description: printer.description,
          },
        })),
      };

      await this.post('/agents/heartbeat', payload);
    } catch (error) {
      this.logger.error(`Heartbeat failed: ${this.errorMessage(error)}`);
    }
  }

  private async safeClaimAndProcess() {
    if (this.isClaiming || !this.baseUrl || !this.apiToken) {
      return;
    }

    this.isClaiming = true;

    try {
      const printers = await this.printService.getPrinters();
      const supportedPrinters = printers.map((printer) =>
        this.buildPrinterUid(printer.name),
      );

      if (supportedPrinters.length === 0) {
        return;
      }

      const response = await this.post('/jobs/claim', {
        event_id: this.eventId,
        agent_key: this.agentKey,
        batch_size: this.claimBatchSize,
        supported_printers: supportedPrinters,
      });

      const jobs: HubJob[] = Array.isArray(response?.jobs) ? response.jobs : [];

      for (const job of jobs) {
        await this.processJob(job);
      }
    } catch (error) {
      this.logger.error(`Claim/process failed: ${this.errorMessage(error)}`);
    } finally {
      this.isClaiming = false;
    }
  }

  private async processJob(job: HubJob) {
    const startedAt = new Date().toISOString();

    try {
      const payload = job.payload || {};
      const type = payload.type;
      const printerName =
        payload.printerName || this.printerNameFromUid(job.target_printer_uid);

      if (!printerName) {
        throw new Error('Missing printer name for claimed job');
      }

      let success = false;
      let nativeJobId: string | undefined;

      if (type === 'text') {
        const result = await this.printService.printText({
          name: payload.name,
          nickname: payload.nickname,
          copies: payload.copies || 1,
          printerName,
          course: payload.course,
        });
        success = !!result.success;
        nativeJobId = result.jobId;

        if (!success) {
          throw new Error(result.error || 'Text print failed');
        }
      } else if (type === 'pdf') {
        const result = await this.printService.printPDF({
          pdfData: payload.pdfData,
          copies: payload.copies || 1,
          printerName,
          paperSize: payload.paperSize || 'A4',
          orientation: payload.orientation || 'portrait',
        });
        success = !!result.success;
        nativeJobId = result.jobId;

        if (!success) {
          throw new Error(result.error || 'PDF print failed');
        }
      } else {
        throw new Error(`Unsupported job type: ${type}`);
      }

      if (success) {
        await this.ackSuccess(job, startedAt, nativeJobId);
      }
    } catch (error) {
      await this.ackFailure(job, startedAt, error, true).catch((ackError) => {
        this.logger.error(
          `Failed to ack failure for job ${job.job_id} via Prisma: ${ackError?.message}`,
        );
      });

      this.logger.error(
        `Job ${job.job_id} failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private async ackSuccess(
    job: HubJob,
    startedAt: string,
    nativeJobId: string | undefined,
  ) {
    const agent = await prisma.printerAgent.findUnique({
      where: { agent_key: this.agentKey },
    });

    if (!agent) {
      throw new Error(`Agent with key ${this.agentKey} not found.`);
    }

    const jobToUpdate = await prisma.printJob.findUnique({
      where: { id: job.job_id },
    });

    if (!jobToUpdate) {
      throw new Error(`Job ${job.job_id} not found.`);
    }

    if (jobToUpdate.leasedByAgentId !== agent.id) {
      throw new Error(
        `Job ${job.job_id} does not belong to agent ${agent.id}.`,
      );
    }

    const now = new Date();
    const durationMs = now.getTime() - new Date(startedAt).getTime();
    const metadata = {
      idempotency_key: job.idempotency_key,
      native_job_id: nativeJobId,
    };

    await prisma.$transaction([
      prisma.printJob.update({
        where: { id: job.job_id },
        data: {
          status: 'succeeded',
          leaseExpiresAt: null,
          resultJson: {
            duration_ms: durationMs,
            metadata: metadata,
            acknowledged_at: now.toISOString(),
          },
        },
      }),
      prisma.printJobAttempt.create({
        data: {
          printJobId: job.job_id,
          printerAgentId: agent.id,
          startedAt: new Date(startedAt),
          finishedAt: now,
          success: true,
          metadataJson: metadata,
        },
      }),
    ]);

    this.logger.log(`Job ${job.job_id} successfully acknowledged via Prisma.`);
  }

  private async ackFailure(
    job: HubJob,
    startedAt: string,
    error: unknown,
    retryable: boolean,
  ) {
    const agent = await prisma.printerAgent.findUnique({
      where: { agent_key: this.agentKey },
    });

    if (!agent) {
      throw new Error(`Agent with key ${this.agentKey} not found.`);
    }

    const jobToUpdate = await prisma.printJob.findUnique({
      where: { id: job.job_id },
    });

    if (!jobToUpdate) {
      throw new Error(`Job ${job.job_id} not found.`);
    }

    if (jobToUpdate.leasedByAgentId !== agent.id) {
      throw new Error(
        `Job ${job.job_id} does not belong to agent ${agent.id}.`,
      );
    }

    const now = new Date();
    const errorCode = 'PRINT_EXECUTION_ERROR';
    const errorMessage = this.errorMessage(error);

    const newAttemptCount = jobToUpdate.attemptCount + 1;
    const canRetry = retryable && newAttemptCount < jobToUpdate.maxAttempts;
    const nextStatus = canRetry
      ? 'pending'
      : newAttemptCount >= jobToUpdate.maxAttempts
        ? 'dead'
        : 'failed';

    await prisma.$transaction([
      prisma.printJob.update({
        where: { id: job.job_id },
        data: {
          attemptCount: newAttemptCount,
          status: nextStatus,
          leaseExpiresAt: null,
          leasedByAgentId: null,
          resultJson: {
            error_code: errorCode,
            error_message: errorMessage,
            retryable: retryable,
            acknowledged_at: now.toISOString(),
          },
        },
      }),
      prisma.printJobAttempt.create({
        data: {
          printJobId: job.job_id,
          printerAgentId: agent.id,
          startedAt: new Date(startedAt),
          finishedAt: now,
          success: false,
          errorCode: errorCode,
          errorMessage: errorMessage,
          metadataJson: { idempotency_key: job.idempotency_key },
        },
      }),
    ]);

    this.logger.log(
      `Job ${job.job_id} successfully acknowledged failure via Prisma. New status: ${nextStatus}`,
    );
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unexpected error';
  }

  private buildPrinterUid(printerName: string): string {
    const prefix = this.configService.get<string>('printerHub.uidPrefix');
    if (prefix && prefix.trim().length > 0) {
      return `${prefix.trim()}${printerName}`;
    }

    return `${process.platform}://${printerName}`;
  }

  private printerNameFromUid(printerUid: string): string {
    const parts = String(printerUid || '').split('://');
    if (parts.length >= 2) {
      return parts.slice(1).join('://');
    }

    return printerUid;
  }

  private async post(path: string, payload: any): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: this.apiToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        `Hub POST ${path} failed with ${response.status}: ${JSON.stringify(body)}`,
      );
    }

    return body;
  }
}
