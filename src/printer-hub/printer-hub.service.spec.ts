import { ConfigService } from '@nestjs/config';
import { PrinterHubService } from './printer-hub.service';
import { PrintService } from '../print/print.service';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  __esModule: true,
  default: {
    printerAgent: {
      findUnique: jest.fn(),
    },
    printJob: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    printJobAttempt: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

describe('PrinterHubService', () => {
  let service: PrinterHubService;
  const prismaMock = prisma as any;

  const configServiceMock = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const values: Record<string, unknown> = {
        'printerHub.agentKey': 'test-agent-key',
      };

      return values[key] ?? defaultValue;
    }),
  };

  const printServiceMock = {
    getPrinters: jest.fn(),
    printText: jest.fn(),
    printPDF: jest.fn(),
  };

  const job = {
    job_id: '99',
    mode: 'temporary',
    target_printer_uid: 'printer-uid-1',
    payload: { type: 'text', name: 'Test User' },
    idempotency_key: 'idem-ack-success-1',
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T12:00:02.000Z'));
    jest.clearAllMocks();

    service = new PrinterHubService(
      configServiceMock as unknown as ConfigService,
      printServiceMock as unknown as PrintService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('ackSuccess', () => {
    it('marks the leased job as succeeded and creates a successful attempt', async () => {
      const agent = { id: 10n, agentKey: 'test-agent-key' };
      const jobToUpdate = { id: 99n, leasedByAgentId: agent.id };
      const updateOperation = Promise.resolve({ id: jobToUpdate.id });
      const attemptOperation = Promise.resolve({ id: 1n });

      prismaMock.printerAgent.findUnique.mockResolvedValue(agent);
      prismaMock.printJob.findUnique.mockResolvedValue(jobToUpdate);
      prismaMock.printJob.update.mockReturnValue(updateOperation);
      prismaMock.printJobAttempt.create.mockReturnValue(attemptOperation);
      prismaMock.$transaction.mockResolvedValue([
        await updateOperation,
        await attemptOperation,
      ]);

      await (service as any).ackSuccess(
        job,
        '2026-08-06T12:00:00.000Z',
        'native-job-123',
      );

      expect(prismaMock.printerAgent.findUnique).toHaveBeenCalledWith({
        where: { agentKey: 'test-agent-key' },
      });
      expect(prismaMock.printJob.findUnique).toHaveBeenCalledWith({
        where: { id: 99 },
      });
      expect(prismaMock.printJob.update).toHaveBeenCalledWith({
        where: { id: 99 },
        data: {
          status: 'succeeded',
          leaseExpiresAt: null,
          resultJson: {
            duration_ms: 2000,
            metadata: {
              idempotency_key: 'idem-ack-success-1',
              native_job_id: 'native-job-123',
            },
            acknowledged_at: '2026-08-06T12:00:02.000Z',
          },
        },
      });
      expect(prismaMock.printJobAttempt.create).toHaveBeenCalledWith({
        data: {
          printJobId: 99,
          printerAgentId: 10n,
          startedAt: new Date('2026-08-06T12:00:00.000Z'),
          finishedAt: new Date('2026-08-06T12:00:02.000Z'),
          success: true,
          metadataJson: {
            idempotency_key: 'idem-ack-success-1',
            native_job_id: 'native-job-123',
          },
        },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledWith([
        updateOperation,
        attemptOperation,
      ]);
    });

    it('throws when the agent is not found', async () => {
      prismaMock.printerAgent.findUnique.mockResolvedValue(null);

      await expect(
        (service as any).ackSuccess(
          job,
          '2026-08-06T12:00:00.000Z',
          undefined,
        ),
      ).rejects.toThrow('Agent with key test-agent-key not found.');

      expect(prismaMock.printJob.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws when the job is not found', async () => {
      prismaMock.printerAgent.findUnique.mockResolvedValue({
        id: 10n,
        agentKey: 'test-agent-key',
      });
      prismaMock.printJob.findUnique.mockResolvedValue(null);

      await expect(
        (service as any).ackSuccess(
          job,
          '2026-08-06T12:00:00.000Z',
          undefined,
        ),
      ).rejects.toThrow('Job 99 not found.');

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws when the job belongs to another agent', async () => {
      prismaMock.printerAgent.findUnique.mockResolvedValue({
        id: 10n,
        agentKey: 'test-agent-key',
      });
      prismaMock.printJob.findUnique.mockResolvedValue({
        id: 99n,
        leasedByAgentId: 11n,
      });

      await expect(
        (service as any).ackSuccess(
          job,
          '2026-08-06T12:00:00.000Z',
          undefined,
        ),
      ).rejects.toThrow('Job 99 does not belong to agent 10.');

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });
});
