import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
const request = require('supertest');
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/guards/auth.guard';
import { QueueService } from '../src/queue/queue.service';
import { PrintService } from '../src/print/print.service';

const mockJwtAuthGuard = {
  canActivate: jest.fn(() => true),
};

describe('PrintController (e2e)', () => {
  let app: INestApplication;
  let queueService: QueueService;
  let printService: PrintService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();

    queueService = moduleFixture.get<QueueService>(QueueService);
    printService = moduleFixture.get<PrintService>(PrintService);

    jest.spyOn(queueService, 'addPdfJob').mockResolvedValue({
      jobId: 'test-job-id',
      requestId: 'test-request-id',
    });
    jest.spyOn(queueService, 'addTextJob').mockResolvedValue({
      jobId: 'test-job-id',
      requestId: 'test-request-id',
    });
    jest.spyOn(queueService, 'getQueueStatus').mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    });
    jest.spyOn(printService, 'getPrinters').mockResolvedValue([
      {
        name: 'test-printer',
        isDefault: true,
        status: 'ready',
        isOnline: true,
      },
    ]);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
    jest.clearAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /print/pdf', () => {
    it('should accept PDF print job', async () => {
      const printPdfDto = {
        pdfData:
          'JVBERi0xLjUKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCg==',
        printerName: 'test-printer',
        copies: 1,
      };

      const response = await request(app.getHttpServer())
        .post('/print/pdf')
        .set('Authorization', 'Bearer mock-token')
        .send(printPdfDto)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.jobId).toBe('test-job-id');
      expect(response.body.data.requestId).toBe('test-request-id');
      expect(queueService.addPdfJob).toHaveBeenCalledWith(printPdfDto);
    });

    it('should reject invalid PDF data', async () => {
      const invalidPdfDto = {
        pdfData: 'invalid-base64!@#$',
        printerName: 'test-printer',
      };

      await request(app.getHttpServer())
        .post('/print/pdf')
        .set('Authorization', 'Bearer mock-token')
        .send(invalidPdfDto)
        .expect(400);
    });
  });

  describe('POST /print/text', () => {
    it('should accept text print job', async () => {
      const printTextDto = {
        text: 'Test receipt content\nLine 2\nLine 3',
        printerName: 'thermal-printer',
        copies: 2,
      };

      const response = await request(app.getHttpServer())
        .post('/print/text')
        .set('Authorization', 'Bearer mock-token')
        .send(printTextDto)
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.queue).toBe('print');
      expect(queueService.addTextJob).toHaveBeenCalledWith(printTextDto);
    });
  });

  describe('GET /print/printers', () => {
    it('should return available printers', async () => {
      const response = await request(app.getHttpServer())
        .get('/print/printers')
        .set('Authorization', 'Bearer mock-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data.printers)).toBe(true);
      expect(response.body.data.printers[0].name).toBe('test-printer');
      expect(printService.getPrinters).toHaveBeenCalled();
    });
  });

  describe('GET /print/queue/status', () => {
    it('should return queue status', async () => {
      const response = await request(app.getHttpServer())
        .get('/print/queue/status')
        .set('Authorization', 'Bearer mock-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.waiting).toBe(0);
      expect(response.body.data.active).toBe(0);
      expect(queueService.getQueueStatus).toHaveBeenCalled();
    });
  });

  describe('GET /print/health', () => {
    it('should return health status without auth', async () => {
      const response = await request(app.getHttpServer())
        .get('/print/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('healthy');
      expect(response.body.data.service).toBe('IBCPrinter');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without token for protected routes', async () => {
      await request(app.getHttpServer())
        .post('/print/pdf')
        .send({ pdfData: 'test' })
        .expect(401);
    });
  });
});
