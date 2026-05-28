import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Pool,
  PoolConnection,
  RowDataPacket,
  createPool,
} from 'mysql2/promise';

export interface PrinterAgentPayload {
  eventId: string;
  agentKey: string;
  name: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface HeartbeatPrinterPayload {
  printerUid: string;
  displayName: string;
  systemName: string;
  isDefault: boolean;
  isOnline: boolean;
  deviceId?: string;
  capabilities?: Record<string, unknown>;
}

export interface ClaimedJob {
  jobId: number;
  mode: 'temporary' | 'queue';
  targetPrinterUid: string;
  payload: Record<string, any>;
  idempotencyKey: string;
}

interface PrintJobRow extends RowDataPacket {
  id: number;
  mode: 'temporary' | 'queue';
  target_printer_uid: string;
  payload_json: Record<string, any> | string | null;
  idempotency_key: string;
}

interface PrinterAgentRow extends RowDataPacket {
  id: number;
}

@Injectable()
export class PrinterHubRepository implements OnModuleDestroy {
  private readonly logger = new Logger(PrinterHubRepository.name);
  private pool: Pool | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleDestroy() {
    if (this.pool) {
      void this.pool.end();
      this.pool = null;
    }
  }

  isConfigured(): boolean {
    return !!(
      this.configService.get<string>('printerDatabase.host') &&
      this.configService.get<string>('printerDatabase.user') &&
      this.configService.get<string>('printerDatabase.database')
    );
  }

  async registerAgent(payload: PrinterAgentPayload): Promise<void> {
    const connection = await this.getConnection();

    try {
      const now = new Date();
      await this.upsertAgent(connection, payload, now);
    } finally {
      connection.release();
    }
  }

  async heartbeat(
    payload: PrinterAgentPayload,
    printers: HeartbeatPrinterPayload[],
    staleAfterSeconds: number,
    hardInactiveMinutes: number,
  ): Promise<void> {
    const connection = await this.getConnection();

    try {
      await connection.beginTransaction();

      const now = new Date();
      const staleThreshold = new Date(now.getTime() - staleAfterSeconds * 1000);
      const hardInactiveThreshold = new Date(
        now.getTime() - hardInactiveMinutes * 60 * 1000,
      );

      await this.upsertAgent(connection, payload, now);
      const agentId = await this.findAgentId(connection, payload.eventId, payload.agentKey);

      const seenUids: string[] = [];

      for (const printer of printers) {
        seenUids.push(printer.printerUid);

        await connection.execute(
          `
            INSERT INTO printers (
              event_id,
              printer_agent_id,
              printer_uid,
              name,
              is_default,
              is_online,
              capabilities_json,
              status_reason,
              last_seen_at,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), NULL, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              event_id = VALUES(event_id),
              printer_agent_id = VALUES(printer_agent_id),
              name = VALUES(name),
              is_default = VALUES(is_default),
              is_online = VALUES(is_online),
              capabilities_json = VALUES(capabilities_json),
              status_reason = NULL,
              last_seen_at = VALUES(last_seen_at),
              updated_at = VALUES(updated_at)
          `,
          [
            payload.eventId,
            agentId,
            printer.printerUid,
            printer.displayName,
            printer.isDefault,
            printer.isOnline,
            this.json({
              ...(printer.capabilities || {}),
              system_name: printer.systemName,
              pnp_device_id: printer.deviceId || null,
            }),
            now,
            now,
            now,
          ],
        );
      }

      if (seenUids.length > 0) {
        await connection.query(
          `
            UPDATE printers
            SET is_online = FALSE,
                status_reason = 'not_reported_in_heartbeat',
                updated_at = ?
            WHERE printer_agent_id = ?
              AND printer_uid NOT IN (${seenUids.map(() => '?').join(', ')})
          `,
          [now, agentId, ...seenUids],
        );
      } else {
        await connection.execute(
          `
            UPDATE printers
            SET is_online = FALSE,
                status_reason = 'not_reported_in_heartbeat',
                updated_at = ?
            WHERE printer_agent_id = ?
          `,
          [now, agentId],
        );
      }

      await this.markInactive(connection, payload.eventId, now, staleThreshold, hardInactiveThreshold);

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async runMaintenance(
    eventId: string,
    staleAfterSeconds: number,
    hardInactiveMinutes: number,
    temporarySuccessTtlHours: number,
  ): Promise<void> {
    const connection = await this.getConnection();

    try {
      const now = new Date();
      const staleThreshold = new Date(now.getTime() - staleAfterSeconds * 1000);
      const hardInactiveThreshold = new Date(
        now.getTime() - hardInactiveMinutes * 60 * 1000,
      );
      const cleanupThreshold = new Date(
        now.getTime() - temporarySuccessTtlHours * 60 * 60 * 1000,
      );

      await connection.execute(
        `
          UPDATE print_jobs
          SET status = 'pending',
              leased_by_agent_id = NULL,
              lease_expires_at = NULL,
              updated_at = ?
          WHERE status = 'leased'
            AND event_id = ?
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < ?
        `,
        [now, eventId, now],
      );

      await this.markInactive(connection, eventId, now, staleThreshold, hardInactiveThreshold);

      await connection.execute(
        `
          DELETE print_job_attempts
          FROM print_job_attempts
          INNER JOIN print_jobs ON print_jobs.id = print_job_attempts.print_job_id
          WHERE print_jobs.event_id = ?
            AND print_jobs.mode = 'temporary'
            AND print_jobs.status = 'succeeded'
            AND print_jobs.updated_at < ?
        `,
        [eventId, cleanupThreshold],
      );

      await connection.execute(
        `
          DELETE FROM print_jobs
          WHERE event_id = ?
            AND mode = 'temporary'
            AND status = 'succeeded'
            AND updated_at < ?
        `,
        [eventId, cleanupThreshold],
      );
    } finally {
      connection.release();
    }
  }

  async claimJobs(
    eventId: string,
    agentKey: string,
    supportedPrinters: string[],
    batchSize: number,
    leaseSeconds: number,
    staleAfterSeconds: number,
  ): Promise<ClaimedJob[]> {
    if (supportedPrinters.length === 0) {
      return [];
    }

    const connection = await this.getConnection();

    try {
      await connection.beginTransaction();

      const now = new Date();
      const staleThreshold = new Date(now.getTime() - staleAfterSeconds * 1000);
      const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000);
      const agentId = await this.findAgentId(connection, eventId, agentKey);

      const [rows] = await connection.query<PrintJobRow[]>(
        `
          SELECT print_jobs.id,
                 print_jobs.mode,
                 print_jobs.target_printer_uid,
                 print_jobs.payload_json,
                 print_jobs.idempotency_key
          FROM print_jobs
          INNER JOIN printers ON printers.printer_uid = print_jobs.target_printer_uid
          WHERE print_jobs.status = 'pending'
            AND print_jobs.event_id = ?
            AND print_jobs.target_printer_uid IN (${supportedPrinters.map(() => '?').join(', ')})
            AND printers.event_id = ?
            AND printers.is_online = TRUE
            AND printers.last_seen_at >= ?
            AND (print_jobs.lease_expires_at IS NULL OR print_jobs.lease_expires_at < ?)
          ORDER BY print_jobs.priority DESC, print_jobs.created_at ASC
          LIMIT ?
          FOR UPDATE
        `,
        [
          eventId,
          ...supportedPrinters,
          eventId,
          staleThreshold,
          now,
          batchSize,
        ],
      );

      if (rows.length === 0) {
        await connection.commit();
        return [];
      }

      const jobIds = rows.map((row) => row.id);
      await connection.query(
        `
          UPDATE print_jobs
          SET status = 'leased',
              leased_by_agent_id = ?,
              lease_expires_at = ?,
              updated_at = ?
          WHERE id IN (${jobIds.map(() => '?').join(', ')})
        `,
        [agentId, leaseExpiresAt, now, ...jobIds],
      );

      await connection.commit();

      return rows.map((row) => ({
        jobId: row.id,
        mode: row.mode,
        targetPrinterUid: row.target_printer_uid,
        payload: this.parseJson(row.payload_json),
        idempotencyKey: row.idempotency_key,
      }));
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async ackSuccess(params: {
    eventId: string;
    agentKey: string;
    jobId: number;
    startedAt: Date;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const connection = await this.getConnection();

    try {
      await connection.beginTransaction();

      const now = new Date();
      const agentId = await this.findAgentId(connection, params.eventId, params.agentKey);
      await this.lockOwnedJob(connection, params.jobId, agentId);

      await connection.execute(
        `
          UPDATE print_jobs
          SET status = 'succeeded',
              lease_expires_at = NULL,
              result_json = CAST(? AS JSON),
              updated_at = ?
          WHERE id = ?
        `,
        [
          this.json({
            duration_ms: params.durationMs,
            metadata: params.metadata || {},
            acknowledged_at: now.toISOString(),
          }),
          now,
          params.jobId,
        ],
      );

      await connection.execute(
        `
          INSERT INTO print_job_attempts (
            print_job_id,
            printer_agent_id,
            started_at,
            finished_at,
            success,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, TRUE, CAST(? AS JSON), ?, ?)
        `,
        [
          params.jobId,
          agentId,
          params.startedAt,
          now,
          this.json(params.metadata || {}),
          now,
          now,
        ],
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async ackFailure(params: {
    eventId: string;
    agentKey: string;
    jobId: number;
    startedAt: Date;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    metadata?: Record<string, unknown>;
  }): Promise<'pending' | 'failed' | 'dead'> {
    const connection = await this.getConnection();

    try {
      await connection.beginTransaction();

      const now = new Date();
      const agentId = await this.findAgentId(connection, params.eventId, params.agentKey);
      const [rows] = await connection.query<RowDataPacket[]>(
        `
          SELECT id, attempt_count, max_attempts
          FROM print_jobs
          WHERE id = ?
            AND leased_by_agent_id = ?
          FOR UPDATE
        `,
        [params.jobId, agentId],
      );

      if (rows.length === 0) {
        throw new Error(`Print job ${params.jobId} is not leased by agent ${params.agentKey}`);
      }

      const attemptCount = Number(rows[0].attempt_count || 0) + 1;
      const maxAttempts = Number(rows[0].max_attempts || 0);
      const canRetry = params.retryable && attemptCount < maxAttempts;
      const nextStatus: 'pending' | 'failed' | 'dead' = canRetry
        ? 'pending'
        : attemptCount >= maxAttempts
          ? 'dead'
          : 'failed';

      await connection.execute(
        `
          UPDATE print_jobs
          SET attempt_count = ?,
              status = ?,
              lease_expires_at = NULL,
              leased_by_agent_id = NULL,
              result_json = CAST(? AS JSON),
              updated_at = ?
          WHERE id = ?
        `,
        [
          attemptCount,
          nextStatus,
          this.json({
            error_code: params.errorCode,
            error_message: params.errorMessage,
            retryable: params.retryable,
            acknowledged_at: now.toISOString(),
          }),
          now,
          params.jobId,
        ],
      );

      await connection.execute(
        `
          INSERT INTO print_job_attempts (
            print_job_id,
            printer_agent_id,
            started_at,
            finished_at,
            success,
            error_code,
            error_message,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, FALSE, ?, ?, CAST(? AS JSON), ?, ?)
        `,
        [
          params.jobId,
          agentId,
          params.startedAt,
          now,
          params.errorCode,
          params.errorMessage,
          this.json(params.metadata || {}),
          now,
          now,
        ],
      );

      await connection.commit();
      return nextStatus;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async upsertAgent(
    connection: PoolConnection,
    payload: PrinterAgentPayload,
    now: Date,
  ): Promise<void> {
    await connection.execute(
      `
        INSERT INTO printer_agents (
          event_id,
          agent_key,
          name,
          status,
          version,
          metadata_json,
          last_seen_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'online', ?, CAST(? AS JSON), ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          event_id = VALUES(event_id),
          name = VALUES(name),
          status = 'online',
          version = VALUES(version),
          metadata_json = VALUES(metadata_json),
          last_seen_at = VALUES(last_seen_at),
          updated_at = VALUES(updated_at)
      `,
      [
        payload.eventId,
        payload.agentKey,
        payload.name,
        payload.version || null,
        this.json(payload.metadata || {}),
        now,
        now,
        now,
      ],
    );
  }

  private async findAgentId(
    connection: PoolConnection,
    eventId: string,
    agentKey: string,
  ): Promise<number> {
    const [rows] = await connection.query<PrinterAgentRow[]>(
      `
        SELECT id
        FROM printer_agents
        WHERE event_id = ?
          AND agent_key = ?
        LIMIT 1
      `,
      [eventId, agentKey],
    );

    if (rows.length === 0) {
      throw new Error(`Printer agent ${agentKey} not found for event ${eventId}`);
    }

    return rows[0].id;
  }

  private async lockOwnedJob(
    connection: PoolConnection,
    jobId: number,
    agentId: number,
  ): Promise<void> {
    const [rows] = await connection.query<RowDataPacket[]>(
      `
        SELECT id
        FROM print_jobs
        WHERE id = ?
          AND leased_by_agent_id = ?
        FOR UPDATE
      `,
      [jobId, agentId],
    );

    if (rows.length === 0) {
      throw new Error(`Print job ${jobId} is not leased by agent ${agentId}`);
    }
  }

  private async markInactive(
    connection: PoolConnection,
    eventId: string,
    now: Date,
    staleThreshold: Date,
    hardInactiveThreshold: Date,
  ): Promise<void> {
    await connection.execute(
      `
        UPDATE printers
        SET is_online = FALSE,
            status_reason = 'stale_heartbeat',
            updated_at = ?
        WHERE event_id = ?
          AND last_seen_at < ?
      `,
      [now, eventId, staleThreshold],
    );

    await connection.execute(
      `
        UPDATE printers
        SET is_online = FALSE,
            status_reason = 'inactive_timeout',
            updated_at = ?
        WHERE event_id = ?
          AND last_seen_at < ?
      `,
      [now, eventId, hardInactiveThreshold],
    );

    await connection.execute(
      `
        UPDATE printer_agents
        SET status = 'offline',
            updated_at = ?
        WHERE event_id = ?
          AND last_seen_at < ?
      `,
      [now, eventId, staleThreshold],
    );
  }

  private async getConnection(): Promise<PoolConnection> {
    return this.getPool().getConnection();
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = createPool({
        host: this.configService.get<string>('printerDatabase.host'),
        port: this.configService.get<number>('printerDatabase.port', 3306),
        user: this.configService.get<string>('printerDatabase.user'),
        password: this.configService.get<string>('printerDatabase.password'),
        database: this.configService.get<string>('printerDatabase.database'),
        waitForConnections: true,
        connectionLimit: this.configService.get<number>(
          'printerDatabase.connectionLimit',
          10,
        ),
      });

      this.logger.log('Printer hub MySQL pool initialized');
    }

    return this.pool;
  }

  private json(value: unknown): string {
    return JSON.stringify(value || {});
  }

  private parseJson(value: unknown): Record<string, any> {
    if (!value) {
      return {};
    }

    if (typeof value === 'string') {
      return JSON.parse(value) as Record<string, any>;
    }

    return value as Record<string, any>;
  }
}