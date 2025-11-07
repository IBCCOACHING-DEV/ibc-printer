import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { QueueService } from './queue.service';
import { PrintPdfDto } from '../print/dto/print-pdf.dto';
import { PrintTextDto } from '../print/dto/print-text.dto';

const mockQueue = {
  add: jest.fn(),
  getWaiting: jest.fn(),
  getActive: jest.fn(),
  getCompleted: jest.fn(),
  getFailed: jest.fn(),
  getDelayed: jest.fn(),
  getJob: jest.fn(),
  clean: jest.fn(),
};

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getQueueToken('print'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addPdfJob', () => {
    const printPdfDto: PrintPdfDto = {
      pdfData: 'test-base64',
      printerName: 'test-printer',
    };

    it('should add PDF job to queue', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-123' });

      const result = await service.addPdfJob(printPdfDto);

      expect(result.jobId).toBe('job-123');
      expect(result.requestId).toBeDefined();
      expect(mockQueue.add).toHaveBeenCalledWith(
        'pdf',
        expect.objectContaining({
          type: 'pdf',
          data: printPdfDto,
        }),
        expect.any(Object),
      );
    });
  });

  describe('addTextJob', () => {
    const printTextDto: PrintTextDto = {
      text: 'test text content',
    };

    it('should add text job to queue', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-456' });

      const result = await service.addTextJob(printTextDto);

      expect(result.jobId).toBe('job-456');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'text',
        expect.objectContaining({
          type: 'text',
          data: printTextDto,
        }),
        expect.any(Object),
      );
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status', async () => {
      mockQueue.getWaiting.mockResolvedValue([{}, {}]);
      mockQueue.getActive.mockResolvedValue([{}]);
      mockQueue.getCompleted.mockResolvedValue([{}, {}, {}]);
      mockQueue.getFailed.mockResolvedValue([{}]);
      mockQueue.getDelayed.mockResolvedValue([]);

      const status = await service.getQueueStatus();

      expect(status).toEqual({
        waiting: 2,
        active: 1,
        completed: 3,
        failed: 1,
        delayed: 0,
      });
    });
  });

  describe('getJobStatus', () => {
    it('should return job status', async () => {
      const mockJob = {
        id: 'job-123',
        getState: jest.fn().mockResolvedValue('completed'),
        progress: jest.fn().mockReturnValue(100),
        finished: jest.fn().mockResolvedValue({ success: true }),
        failedReason: null,
        timestamp: 1234567890,
        processedOn: 1234567891,
        finishedOn: 1234567892,
      };

      mockQueue.getJob.mockResolvedValue(mockJob);

      const status = await service.getJobStatus('job-123');

      expect(status).toEqual({
        id: 'job-123',
        state: 'completed',
        progress: 100,
        result: { success: true },
        failedReason: null,
        timestamp: 1234567890,
        processedOn: 1234567891,
        finishedOn: 1234567892,
      });
    });

    it('should return null for non-existent job', async () => {
      mockQueue.getJob.mockResolvedValue(null);

      const status = await service.getJobStatus('non-existent');

      expect(status).toBeNull();
    });
  });
});
