import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hostname } from 'os';
import { PrinterInfo } from '../print/printers/base-printer.interface';
import { PrintService } from '../print/print.service';
import {
  HeartbeatPrinterPayload,
  PrinterHubRepository,
} from './printer-hub.repository';

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

  private static readonly DEFAULT_HEARTBEAT_SECONDS = 90;
  private static readonly DEFAULT_HARD_INACTIVE_MINUTES = 10;
  private static readonly DEFAULT_LEASE_SECONDS = 45;
  private static readonly TEMPORARY_SUCCESS_TTL_HOURS = 24;

  constructor(
    private readonly configService: ConfigService,
    private readonly printService: PrintService,
    private readonly printerHubRepository: PrinterHubRepository,
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
    return (
      this.configService.get<boolean>('printerHub.enabled', false) &&
      this.printerHubRepository.isConfigured()
    );
  }

  private get eventId(): string {
    return this.configService.get<string>('printerHub.eventId', 'default-event');
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

  private get claimBatchSize(): number {
    const raw = this.configService.get<number>('printerHub.claimBatchSize', 1);
    if (raw <= 0) {
      return 1;
    }

    return Math.min(raw, 20);
  }

  private get printerIdentityMap(): Record<string, string> {
    const raw = this.configService.get<string>(
      'printerHub.printerIdentityMap',
      '{}',
    );

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      return Object.entries(parsed).reduce<Record<string, string>>(
        (acc, [deviceId, alias]) => {
          if (typeof alias === 'string' && alias.trim()) {
            acc[this.normalizeIdentity(deviceId)] = alias.trim();
          }

          return acc;
        },
        {},
      );
    } catch (error) {
      this.logger.warn(
        'Invalid PRINTER_IDENTITY_MAP JSON; ignoring printer identity map',
      );
      return {};
    }
  }

  private async safeRegister() {
    try {
      if (!this.printerHubRepository.isConfigured()) {
        this.logger.warn(
          'Printer hub database is not configured; skipping register',
        );
        return;
      }

      await this.printerHubRepository.registerAgent({
        eventId: this.eventId,
        agentKey: this.agentKey,
        name: this.agentName,
        version: process.env.npm_package_version || 'local',
        metadata: {
          os: process.platform,
          arch: process.arch,
          hostname: hostname(),
          node: process.version,
        },
      });

      this.logger.log('Agent register/upsert persisted to printer database');
    } catch (error) {
      this.logger.error(`Register failed: ${this.errorMessage(error)}`);
    }
  }

  private async safeHeartbeat() {
    try {
      if (!this.printerHubRepository.isConfigured()) {
        return;
      }

      const printers = this.filterPrintersByIdentityMap(
        await this.printService.getPrinters(),
      );

      await this.printerHubRepository.heartbeat(
        {
          eventId: this.eventId,
          agentKey: this.agentKey,
          name: this.agentName,
          version: process.env.npm_package_version || 'local',
          metadata: {
            os: process.platform,
            arch: process.arch,
            hostname: hostname(),
          },
        },
        printers.map((printer) => this.toHeartbeatPrinter(printer)),
        PrinterHubService.DEFAULT_HEARTBEAT_SECONDS,
        PrinterHubService.DEFAULT_HARD_INACTIVE_MINUTES,
      );
    } catch (error) {
      this.logger.error(`Heartbeat failed: ${this.errorMessage(error)}`);
    }
  }

  private async safeClaimAndProcess() {
    if (this.isClaiming || !this.printerHubRepository.isConfigured()) {
      return;
    }

    this.isClaiming = true;

    try {
      await this.printerHubRepository.runMaintenance(
        this.eventId,
        PrinterHubService.DEFAULT_HEARTBEAT_SECONDS,
        PrinterHubService.DEFAULT_HARD_INACTIVE_MINUTES,
        PrinterHubService.TEMPORARY_SUCCESS_TTL_HOURS,
      );

      const printers = this.filterPrintersByIdentityMap(
        await this.printService.getPrinters(),
      );
      const printerIndex = new Map(
        printers.map((printer) => [this.buildPrinterUid(printer), printer]),
      );
      const supportedPrinters = [...printerIndex.keys()];

      if (supportedPrinters.length === 0) {
        return;
      }

      const claimedJobs = await this.printerHubRepository.claimJobs(
        this.eventId,
        this.agentKey,
        supportedPrinters,
        this.claimBatchSize,
        PrinterHubService.DEFAULT_LEASE_SECONDS,
        PrinterHubService.DEFAULT_HEARTBEAT_SECONDS,
      );

      const jobs: HubJob[] = claimedJobs.map((job) => ({
        job_id: String(job.jobId),
        mode: job.mode,
        target_printer_uid: job.targetPrinterUid,
        payload: job.payload,
        idempotency_key: job.idempotencyKey,
      }));

      for (const job of jobs) {
        await this.processJob(job, printerIndex);
      }
    } catch (error) {
      this.logger.error(`Claim/process failed: ${this.errorMessage(error)}`);
    } finally {
      this.isClaiming = false;
    }
  }

  private async processJob(job: HubJob, printerIndex: Map<string, PrinterInfo>) {
    const startedAt = new Date();

    try {
      const payload = job.payload || {};
      const type = payload.type;
      const localPrinter = printerIndex.get(job.target_printer_uid);
      const printerName =
        payload.printerName ||
        localPrinter?.systemName ||
        localPrinter?.name ||
        this.printerNameFromUid(job.target_printer_uid);

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
        await this.printerHubRepository.ackSuccess({
          eventId: this.eventId,
          agentKey: this.agentKey,
          jobId: Number(job.job_id),
          startedAt,
          durationMs: Date.now() - startedAt.getTime(),
          metadata: {
            idempotency_key: job.idempotency_key,
            native_job_id: nativeJobId,
          },
        });
      }
    } catch (error) {
      await this.printerHubRepository
        .ackFailure({
          eventId: this.eventId,
          agentKey: this.agentKey,
          jobId: Number(job.job_id),
          startedAt,
          errorCode: 'PRINT_EXECUTION_ERROR',
          errorMessage: this.errorMessage(error),
          retryable: true,
          metadata: {
            idempotency_key: job.idempotency_key,
          },
        })
        .catch((ackError) => {
          this.logger.error(
            `Failed to ack failure for job ${job.job_id}: ${ackError?.message}`,
          );
        });

      this.logger.error(
        `Job ${job.job_id} failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unexpected error';
  }

  private toHeartbeatPrinter(printer: PrinterInfo): HeartbeatPrinterPayload {
    return {
      printerUid: this.buildPrinterUid(printer),
      displayName: this.resolveStableLabel(printer),
      systemName: printer.systemName || printer.name,
      isDefault: !!printer.isDefault,
      isOnline: printer.isOnline !== false,
      deviceId: printer.deviceId,
      capabilities: {
        status: printer.status,
        description: printer.description,
      },
    };
  }

  private buildPrinterUid(printer: string | PrinterInfo): string {
    const identity =
      typeof printer === 'string'
        ? this.normalizeIdentity(printer)
        : this.resolveStableIdentity(printer);
    const prefix = this.configService.get<string>('printerHub.uidPrefix');
    if (prefix && prefix.trim().length > 0) {
      return `${prefix.trim()}${identity}`;
    }

    return `printer://${identity}`;
  }

  private printerNameFromUid(printerUid: string): string {
    const parts = String(printerUid || '').split('://');
    if (parts.length >= 2) {
      return parts.slice(1).join('://');
    }

    return printerUid;
  }

  private resolveStableLabel(printer: PrinterInfo): string {
    const mapKey = this.resolveIdentityMapKey(printer);
    if (mapKey) {
      return this.printerIdentityMap[mapKey] || printer.name;
    }

    return printer.name;
  }

  private resolveStableIdentity(printer: PrinterInfo): string {
    const mapKey = this.resolveIdentityMapKey(printer);
    const mapped = mapKey ? this.printerIdentityMap[mapKey] : undefined;

    if (mapped) {
      return this.normalizeIdentity(mapped);
    }

    const normalizedDeviceId = this.normalizeIdentity(printer.deviceId);

    if (normalizedDeviceId !== 'unknown-printer') {
      return normalizedDeviceId;
    }

    return this.normalizeIdentity(printer.systemName || printer.name);
  }

  private normalizeIdentity(value: string | undefined): string {
    return (
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown-printer'
    );
  }

  private resolveIdentityMapKey(printer: PrinterInfo): string | null {
    const identityMap = this.printerIdentityMap;
    const candidate = this.normalizeIdentity(printer.deviceId);

    if (candidate !== 'unknown-printer' && identityMap[candidate]) {
      return candidate;
    }

    return null;
  }

  private filterPrintersByIdentityMap(printers: PrinterInfo[]): PrinterInfo[] {
    const identityMap = this.printerIdentityMap;
    const mapSize = Object.keys(identityMap).length;

    if (mapSize === 0) {
      return printers;
    }

    const filtered = printers.filter(
      (printer) => this.resolveIdentityMapKey(printer) !== null,
    );

    if (filtered.length === 0 && printers.length > 0) {
      const mapKeys = Object.keys(identityMap);
      const discovered = printers.map((printer) => ({
        name: printer.name,
        systemName: printer.systemName,
        deviceId: printer.deviceId || null,
        normalizedDeviceId: this.normalizeIdentity(printer.deviceId),
      }));

      this.logger.warn(
        `PRINTER_IDENTITY_MAP sem correspondencias por deviceId. map_keys=${JSON.stringify(mapKeys)} discovered=${JSON.stringify(discovered)}`,
      );
    }

    if (filtered.length !== printers.length) {
      this.logger.log(
        `PRINTER_IDENTITY_MAP ativo: ${filtered.length}/${printers.length} impressoras mapeadas e disponibilizadas`,
      );
    }

    return filtered;
  }
}
