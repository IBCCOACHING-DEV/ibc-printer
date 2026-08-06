import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'os';
import { PrintService } from '../print/print.service';
import prisma from '../lib/prisma';


export interface ProcessHeartbeatPayload {
  event_id: string;
  agent_key: string;
  version?: string;
  metadata?: {
    os?: string;
    arch?: string;
    hostname?: string;
    node?: string;
  };
  printers: Array<{
    printerUid: string;
    name: string;
    isDefault: boolean;
    isOnline: boolean;
    capabilitiesJson?: Record<string, string>;
  }>;
}
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
  private readonly staleAfterSeconds = 90;
  private readonly hardInactiveAfterMinutes = 10;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private claimTimer: NodeJS.Timeout | null = null;
  private registrationTimer: NodeJS.Timeout | null = null;
  private isClaiming = false;
  private isHubWorkRunning = false;
  private agentId: bigint | null = null;
  private loopsStarted = false;

  private cachedPrinters: any[] | null = null;
  private lastPrintersFetchTime: number = 0;
  private readonly PRINTER_CACHE_TTL_MS = 5000; // Cache por 5 segundos
  constructor(
    private readonly configService: ConfigService,
    private readonly printService: PrintService,
  ) {}

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('Printer hub integration disabled by config');
      return;
    }

    const registered = await this.safeRegister();
    if (!registered.success || !this.agentId) {
      this.scheduleRegistrationRetry();
      return;
    }

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

    if (this.registrationTimer) {
      clearInterval(this.registrationTimer);
      this.registrationTimer = null;
    }
  }

  private startLoops() {
    if (this.loopsStarted) {
      return;
    }

    const heartbeatMs = this.configService.get<number>(
      'printerHub.heartbeatIntervalMs',
      30000,
    );
    const claimMs = this.configService.get<number>(
      'printerHub.claimIntervalMs',
      100, // Reduzindo o intervalo de claim para 100ms para maior agilidade
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
    this.loopsStarted = true;
  }

  private scheduleRegistrationRetry() {
    if (this.registrationTimer) {
      return;
    }

    this.registrationTimer = setInterval(async () => {
      const registered = await this.safeRegister();
      if (!registered.success || !this.agentId) {
        return;
      }

      if (this.registrationTimer) {
        clearInterval(this.registrationTimer);
        this.registrationTimer = null;
      }

      await this.safeHeartbeat();
      this.startLoops();
    }, 15000);
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
    const configured = this.configService
      .get<string>('printerHub.agentKey', '')
      .trim();

    return configured || hostname();
  }

  private get agentName(): string {
    const configured = this.configService
      .get<string>('printerHub.agentName', '')
      .trim();

    return configured || `ibc-printer-${hostname()}`;
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
      // await this.post('/agents/register', {
      //   event_id: this.eventId,
      //   agent_key: this.agentKey,
      //   name: this.agentName,
      //   version: process.env.npm_package_version || 'local',
      //   metadata: {
      //     os: process.platform,
      //     arch: process.arch,
      //     hostname: hostname(),
      //     node: process.version,
      //   },
      // });

      const agent = await prisma.printerAgent.upsert({
        where: { agentKey: this.agentKey },
        update: {
          eventId: this.eventId,
          name: this.agentName,
          version: process.env.npm_package_version || 'local',
          metadataJson: {
            os: process.platform,
            arch: process.arch,
            hostname: hostname(),
            node: process.version,
          },
          status: 'online',
          lastSeenAt: new Date(),
        },
        create: {
          eventId: this.eventId,
          agentKey: this.agentKey,
          name: this.agentName,
          version: process.env.npm_package_version || 'local',
          metadataJson: {
            os: process.platform,
            arch: process.arch,
            hostname: hostname(),
            node: process.version,
          },
          status: 'online',
          lastSeenAt: new Date(),
        },
      });

      this.logger.log('Agent register/upsert saved');
      this.agentId = agent.id;
      return {
        success: true,
        agent: {
          id: agent.id.toString(),
          status: agent.status,
          server_time: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(`Register failed: ${this.errorMessage(error)}`);
      return {
        success: false,
        errors: [this.errorMessage(error)],
      };
    }
  }

  private async safeHeartbeat() {
    if (!this.agentId) {
      return;
    }

    if (this.isHubWorkRunning) {
      return;
    }

    this.isHubWorkRunning = true;

    try {
      const printers = await this.getPrintersCached();
      
      const reportedPrinters = printers.map((printer) => ({
        printerUid: this.buildPrinterUid(printer.name),
        name: printer.name,
        isDefault: !!printer.isDefault,
        isOnline: printer.isOnline !== false,
        capabilitiesJson: this.buildPrinterCapabilities(printer),
      }));

      const payload = {
        event_id: this.eventId,
        agent_key: this.agentKey,
        version: process.env.npm_package_version || 'local',
        metadata: this.buildAgentMetadata(),
        printers: reportedPrinters,
      };
      
      const heartbeatStartTime = process.hrtime.bigint();
      const response = await this.processHeartbeat(payload);
      const heartbeatEndTime = process.hrtime.bigint();
      this.logger.log(`Heartbeat processado localmente em ${Number(heartbeatEndTime - heartbeatStartTime) / 1_000_000}ms`);
      return response;
    } catch (error) {
      this.logger.error(`Falha no processamento de heartbeat local: ${this.errorMessage(error)}`);
    } finally {
      this.isHubWorkRunning = false;
    }
  }

  async processHeartbeat(payload: ProcessHeartbeatPayload) {
    const now = new Date();
    const eventId = payload.event_id;
    const agentKey = payload.agent_key;
    const reportedPrinters = payload.printers || [];

    const agent = await prisma.printerAgent.findFirst({
      where: { eventId, agentKey },
    });

    if (!agent) throw new NotFoundException('Agente nao encontrado');

    const transactionStartTime = process.hrtime.bigint();
    await prisma.$transaction(async (tx) => {
      await tx.printerAgent.update({
        where: { id: agent.id },
        data: {
          status: 'online',
          version: payload.version,
          metadataJson: payload.metadata,
          lastSeenAt: now,
        },
      });

      // Otimização: Executar upserts de impressoras em paralelo
      const printerOperations = reportedPrinters.map((printer) => {
        return tx.printer.upsert({
          where: { printerUid: printer.printerUid },
          update: {
            eventId,
            printerAgentId: agent.id,
            name: printer.name,
            isDefault: printer.isDefault,
            isOnline: printer.isOnline,
            capabilitiesJson: printer.capabilitiesJson,
            statusReason: null,
            lastSeenAt: now, // Atualiza para o tempo exato
          },
          create: {
            eventId,
            printerAgentId: agent.id,
            printerUid: printer.printerUid,
            name: printer.name,
            isDefault: printer.isDefault,
            isOnline: printer.isOnline,
            capabilitiesJson: printer.capabilitiesJson,
            statusReason: null,
            lastSeenAt: now,
          },
        });
      });
      await Promise.all(printerOperations);
    }, { maxWait: 10000, timeout: 20000 });
    const transactionEndTime = process.hrtime.bigint();
    this.logger.debug(`Heartbeat transaction completed in ${Number(transactionEndTime - transactionStartTime) / 1_000_000}ms`);

    const reportedPrinterUids = reportedPrinters.map((p) => p.printerUid);
    const updateManyStartTime = process.hrtime.bigint();
    await prisma.printer.updateMany({
      where: {
        eventId,
        printerAgentId: agent.id,
        printerUid: { notIn: reportedPrinterUids },
      },
      data: { 
        isOnline: false, 
        statusReason: 'not_reported_in_heartbeat' 
      },
    });
    const updateManyEndTime = process.hrtime.bigint();
    this.logger.debug(`Printer updateMany completed in ${Number(updateManyEndTime - updateManyStartTime) / 1_000_000}ms`);

    const maintenanceStartTime = process.hrtime.bigint();
    await Promise.allSettled([
      this.runMaintenance(now),
      this.markStaleEntitiesOffline(now)
    ]);
    const maintenanceEndTime = process.hrtime.bigint();
    this.logger.debug(`Maintenance tasks completed in ${Number(maintenanceEndTime - maintenanceStartTime) / 1_000_000}ms`);

    return {
      heartbeat_interval_seconds: this.heartbeatIntervalSeconds,
      stale_after_seconds: this.staleAfterSeconds,
      hard_inactive_after_minutes: this.hardInactiveAfterMinutes,
      server_time: now,
    };
  }

  private async runMaintenance(now: Date) {
    await prisma.printJob.updateMany({
      where: {
        status: 'leased',
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: 'pending',
        leasedByAgentId: null,
        leaseExpiresAt: null,
      },
    });

    await prisma.printJob.deleteMany({
      where: {
        mode: 'temporary',
        status: { in: ['succeeded', 'failed', 'dead'] },
        updatedAt: { lt: this.minutesBefore(now, this.hardInactiveAfterMinutes) },
      },
    });
  }

  private async markStaleEntitiesOffline(now: Date) {
    const staleBefore = this.secondsBefore(now, this.staleAfterSeconds);

    await prisma.printer.updateMany({
      where: {
        eventId: this.eventId,
        isOnline: true,
        lastSeenAt: { lt: staleBefore },
      },
      data: {
        isOnline: false,
        statusReason: 'stale_heartbeat',
      },
    });

    await prisma.printerAgent.updateMany({
      where: {
        eventId: this.eventId,
        status: 'online',
        lastSeenAt: { lt: staleBefore },
      },
      data: { status: 'offline' },
    });
  }

  private async safeClaimAndProcess() {
    if (!this.agentId) {
      return;
    }

    if (this.isClaiming) {
      return;
    }

    this.isClaiming = true;

    try {
      const printers = await this.getPrintersCached();
      const supportedPrinters = printers.map((printer) =>
        this.buildPrinterUid(printer.name),
      );

      if (supportedPrinters.length === 0) {
        return;
      }

      const claimPayload = {
        event_id: this.eventId,
        agent_key: this.agentKey,
        batch_size: this.claimBatchSize,
        supported_printers: supportedPrinters,
      };

      const response = await this.claimJobs(claimPayload);
      const jobs: HubJob[] = Array.isArray(response?.jobs) ? response.jobs : [];

      if (jobs.length > 0) {
        this.logger.log(`Reivindicado(s) ${jobs.length} job(s) localmente.`);
      }
      for (const job of jobs) {
        await this.processJob(job);
      }
    } catch (error) {
      this.logger.error(`Falha no loop de reinvindicação/processamento local: ${this.errorMessage(error)}`);
    } finally {
      this.isClaiming = false;
    }
  }

  private async processJob(job: HubJob) {
    const startedAt = new Date().toISOString();
    const jobProcessingStartTime = process.hrtime.bigint();

    try {
      const payload = job.payload || {};
      const type = payload.type;
      const printerName =
        payload.printerName || this.printerNameFromUid(job.target_printer_uid);

      if (!printerName) {
        throw new Error('Missing printer name for claimed job');
      }
      const printServiceStartTime = process.hrtime.bigint();
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
      const printServiceEndTime = process.hrtime.bigint();
      this.logger.log(`Print service call for job ${job.job_id} completed in ${Number(printServiceEndTime - printServiceStartTime) / 1_000_000}ms`);

      if (success) {
        // Fire-and-forget: Acknowledge success in the background
        // This prevents a slow DB from blocking the next job claim.
        this.ackSuccess(job, startedAt, nativeJobId).catch((ackError) => {
          this.logger.error(
            `Background ackSuccess for job ${job.job_id} failed: ${this.errorMessage(
              ackError,
            )}`,
          );
        });
      }
    } catch (error) {
      // Fire-and-forget: Acknowledge failure in the background
      this.ackFailure(job, startedAt, error, true).catch((ackError) => {
        this.logger.error(
          `Background ackFailure for job ${job.job_id} failed: ${this.errorMessage(
            ackError,
          )}`,
        );
      });

      this.logger.error(
        `Job ${job.job_id} failed: ${this.errorMessage(error)}`,
      );
    } finally {
      const jobProcessingEndTime = process.hrtime.bigint();
      this.logger.log(`Job ${job.job_id} processing finished in ${Number(jobProcessingEndTime - jobProcessingStartTime) / 1_000_000}ms`);
    }
  }

  private async ackSuccess(
    job: HubJob,
    startedAt: string,
    nativeJobId: string | undefined,
  ) {
    const agent = await prisma.printerAgent.findUnique({
      where: { agentKey: this.agentKey },
    });

    if (!agent) {
      throw new Error(`Agent with key ${this.agentKey} not found.`);
    }

    const jobToUpdate = await prisma.printJob.findUnique({
      where: { id: Number(job.job_id) },
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
        where: { id: Number(job.job_id) },
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
          printJobId: Number(job.job_id),
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
      where: { agentKey: this.agentKey },
    });

    if (!agent) {
      throw new Error(`Agent with key ${this.agentKey} not found.`);
    }

    const jobToUpdate = await prisma.printJob.findUnique({
      where: { id: Number(job.job_id) },
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
        where: { id: Number(job.job_id) },
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
          printJobId: Number(job.job_id),
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

  private get heartbeatIntervalSeconds(): number {
    const heartbeatMs = this.configService.get<number>(
      'printerHub.heartbeatIntervalMs',
      30000,
    );

    return Math.max(1, Math.round(heartbeatMs / 1000));
  }

  private buildAgentMetadata() {
    return {
      os: process.platform,
      arch: process.arch,
      hostname: hostname(),
      node: process.version,
    };
  }

  private buildPrinterCapabilities(printer: {
    status: string;
    description?: string;
  }) {
    const capabilities: Record<string, string> = {
      status: printer.status,
    };

    if (printer.description) {
      capabilities.description = printer.description;
    }

    return capabilities;
  }

  private secondsBefore(date: Date, seconds: number): Date {
    return new Date(date.getTime() - seconds * 1000);
  }

  private minutesBefore(date: Date, minutes: number): Date {
    return new Date(date.getTime() - minutes * 60 * 1000);
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

  private async getPrintersCached(): Promise<any[]> {
    const now = Date.now();
    if (this.cachedPrinters && (now - this.lastPrintersFetchTime < this.PRINTER_CACHE_TTL_MS)) {
      return this.cachedPrinters;
    }

    const printers = await this.printService.getPrinters();
    this.cachedPrinters = printers;
    this.lastPrintersFetchTime = now;
    return printers;
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

 async claimJobs(payload: {
    event_id: string;
    agent_key: string;
    batch_size?: number;
    supported_printers?: string[];
  }) {
    const eventId = payload.event_id;
    const agentKey = payload.agent_key;
    const supportedPrinters = Array.isArray(payload.supported_printers)
      ? payload.supported_printers
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];

    const batchSize = Math.min(Math.max(payload.batch_size ?? 1, 1), 20);
    const leaseSeconds = 45;
    const now = new Date();
    const offlineThreshold = new Date(now.getTime() - 90 * 1000);
    
    if (supportedPrinters.length === 0) {
      return {
        success: true,
        lease_seconds: leaseSeconds,
        jobs: [],
      };
    }

    if (!this.agentId) {
      throw new NotFoundException('Printer agent not found in memory');
    }

    const orderedJobs = await prisma.$transaction(async (tx) => {
      const printerPlaceholders = supportedPrinters.map(() => '?').join(', ');
      
      const rows = (await tx.$queryRawUnsafe(
        `SELECT pj.id
         FROM print_jobs pj
         INNER JOIN printers p
           ON p.event_id = pj.event_id
           AND p.printer_uid = pj.target_printer_uid
         WHERE pj.status = 'pending'
           AND pj.event_id = ?
           AND pj.target_printer_uid IN (${printerPlaceholders})
           AND p.is_online = TRUE
           AND p.last_seen_at >= ?
           AND (pj.lease_expires_at IS NULL OR pj.lease_expires_at < ?)
         ORDER BY pj.priority DESC, pj.created_at ASC
         LIMIT ?
         FOR UPDATE SKIP LOCKED`, // <-- ISSO SALVA SUA APLICAÇÃO DE TRAVAR!
        eventId,
        ...supportedPrinters,
        offlineThreshold,
        now,
        batchSize,
      )) as Array<{ id: bigint }>;

      const jobIds = rows.map((row) => Number(row.id));
      if (jobIds.length === 0) return [];

      const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);

      await tx.printJob.updateMany({
        where: { id: { in: jobIds } },
        data: {
          status: 'leased',
          leasedByAgentId: this.agentId,
          leaseExpiresAt,
        },
      });

      return await tx.printJob.findMany({
        where: { id: { in: jobIds } },
      });
    });

    return {
      success: true,
      lease_seconds: leaseSeconds,
      jobs: orderedJobs.map((job) => ({
        job_id: job.id.toString(),
        mode: job.mode as 'temporary' | 'queue',
        target_printer_uid: job.targetPrinterUid,
        payload: job.payloadJson,
        idempotency_key: job.idempotencyKey,
      })),
    };
  }
}
