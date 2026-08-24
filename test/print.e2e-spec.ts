import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/guards/auth.guard';
import { PrintService } from '../src/print/print.service';

const mockJwtAuthGuard = {
  canActivate: jest.fn(() => true),
};

describe('PrintController (e2e)', () => {
  let app: INestApplication;
  let printService: PrintService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();

    printService = moduleFixture.get<PrintService>(PrintService);

    jest.spyOn(printService, 'printPDF').mockResolvedValue({
      success: true,
      jobId: 'test-job-id',
      printer: 'test-printer',
      timestamp: new Date(),
    });
    jest.spyOn(printService, 'printText').mockResolvedValue({
      success: true,
      jobId: 'test-job-id',
      printer: 'thermal-printer',
      timestamp: new Date(),
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
    it('should print a PDF immediately (no queue)', async () => {
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
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.printer).toBe('test-printer');
      expect(printService.printPDF).toHaveBeenCalledWith(printPdfDto);
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
    it('should print a label immediately (no queue)', async () => {
      const printTextDto = {
        name: 'Maria Teste',
        nickname: 'Maria',
        course: 'Turma de Teste',
        printerName: 'thermal-printer',
        copies: 1,
      };

      const response = await request(app.getHttpServer())
        .post('/print/text')
        .set('Authorization', 'Bearer mock-token')
        .send(printTextDto)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(printService.printText).toHaveBeenCalledWith(printTextDto);
    });

    it('should reject a payload missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/print/text')
        .set('Authorization', 'Bearer mock-token')
        .send({ printerName: 'thermal-printer' })
        .expect(400);
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

  describe('GET /print/health', () => {
    it('should return health status without auth', async () => {
      const response = await request(app.getHttpServer())
        .get('/print/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('healthy');
      expect(response.body.data.service).toBe('Checkin Pocket');
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
