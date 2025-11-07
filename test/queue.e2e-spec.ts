import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { QueueService } from '../src/queue/queue.service';

describe('Queue System (e2e)', () => {
  let app: INestApplication;
  let queueService: QueueService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    queueService = moduleFixture.get<QueueService>(QueueService);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Queue Operations', () => {
    it('should process jobs in sequence', async () => {
      const job1 = await queueService.addPdfJob({
        pdfData: 'pdf-base64-1',
        printerName: 'test-printer',
      });

      const job2 = await queueService.addTextJob({
        text: 'test text content',
      });

      const status1 = await queueService.getJobStatus(job1.jobId);
      const status2 = await queueService.getJobStatus(job2.jobId);

      expect(job1.jobId).toBeDefined();
      expect(job2.jobId).toBeDefined();
      expect(status1).toBeDefined();
      expect(status2).toBeDefined();
    });

    it('should maintain queue statistics', async () => {
      const status = await queueService.getQueueStatus();

      expect(typeof status.waiting).toBe('number');
      expect(typeof status.active).toBe('number');
      expect(typeof status.completed).toBe('number');
      expect(typeof status.failed).toBe('number');
      expect(typeof status.delayed).toBe('number');
    });
  });
});
