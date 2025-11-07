import { Test, TestingModule } from '@nestjs/testing';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';
import { QueueService } from '../queue/queue.service';
import { PrintPdfDto } from './dto/print-pdf.dto';
import { PrintTextDto } from './dto/print-text.dto';
import { JwtAuthGuard } from '../auth/guards/auth.guard';

const mockQueueService = {
  addPdfJob: jest.fn(),
  addTextJob: jest.fn(),
  getQueueStatus: jest.fn(),
  getJobStatus: jest.fn(),
  cleanQueue: jest.fn(),
};

const mockPrintService = {
  getPrinters: jest.fn(),
  validatePrinter: jest.fn(),
  getPrinterInfo: jest.fn(),
};

describe('PrintController', () => {
  let controller: PrintController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrintController],
      providers: [
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
        {
          provide: PrintService,
          useValue: mockPrintService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<PrintController>(PrintController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('printPDF', () => {
    const printPdfDto: PrintPdfDto = {
      pdfData: 'test-base64-data',
      printerName: 'test-printer',
    };

    it('should add PDF job to queue', async () => {
      mockQueueService.addPdfJob.mockResolvedValue({
        jobId: 'job-123',
        requestId: 'req-456',
      });
      mockQueueService.getQueueStatus.mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });

      const result = await controller.printPDF(printPdfDto);

      expect(result.success).toBe(true);
      expect(result.data.jobId).toBe('job-123');
      expect(result.data.requestId).toBe('req-456');
      expect(mockQueueService.addPdfJob).toHaveBeenCalledWith(printPdfDto);
    });
  });

  describe('printText', () => {
    const printTextDto: PrintTextDto = {
      text: 'test text content',
    };

    it('should add text job to queue', async () => {
      mockQueueService.addTextJob.mockResolvedValue({
        jobId: 'job-789',
        requestId: 'req-abc',
      });
      mockQueueService.getQueueStatus.mockResolvedValue({
        waiting: 1,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
      });

      const result = await controller.printText(printTextDto);

      expect(result.success).toBe(true);
      expect(result.data.jobId).toBe('job-789');
      expect(result.data.estimatedPosition).toBe(2);
    });
  });

  describe('getPrinters', () => {
    it('should return list of printers', async () => {
      const mockPrinters = [
        { name: 'Printer1', isDefault: true, status: 'ready', isOnline: true },
        {
          name: 'Printer2',
          isDefault: false,
          status: 'offline',
          isOnline: false,
        },
      ];
      mockPrintService.getPrinters.mockResolvedValue(mockPrinters);

      const result = await controller.getPrinters();

      expect(result.success).toBe(true);
      expect(result.data.printers).toEqual(mockPrinters);
      expect(result.data.total).toBe(2);
      expect(result.data.default).toBe('Printer1');
    });
  });

  describe('healthCheck', () => {
    it('should return health status', async () => {
      mockPrintService.getPrinters.mockResolvedValue([
        { name: 'Printer1', isDefault: true, status: 'ready', isOnline: true },
      ]);
      mockQueueService.getQueueStatus.mockResolvedValue({
        waiting: 0,
        active: 0,
        completed: 10,
        failed: 1,
        delayed: 0,
      });

      const result = await controller.healthCheck();

      expect(result.success).toBe(true);
      expect(result.status).toBe('healthy');
      expect(result.data.printers.available).toBe(true);
      expect(result.data.printers.total).toBe(1);
      expect(result.data.queue.completed).toBe(10);
    });
  });
});
