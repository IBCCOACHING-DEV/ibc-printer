import { Test, TestingModule } from '@nestjs/testing';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';
import { PrintPdfDto } from './dto/print-pdf.dto';
import { PrintTextDto } from './dto/print-text.dto';
import { JwtAuthGuard } from '../auth/guards/auth.guard';

const mockPrintService = {
  getPrinters: jest.fn(),
  validatePrinter: jest.fn(),
  getPrinterInfo: jest.fn(),
  printPDF: jest.fn(),
  printText: jest.fn(),
};

describe('PrintController', () => {
  let controller: PrintController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrintController],
      providers: [
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

    it('should print the PDF immediately and return the result', async () => {
      mockPrintService.printPDF.mockResolvedValue({
        success: true,
        jobId: 'job-123',
        printer: 'test-printer',
        timestamp: new Date(),
      });

      const result = await controller.printPDF(printPdfDto);

      expect(result.success).toBe(true);
      expect(result.data.jobId).toBe('job-123');
      expect(mockPrintService.printPDF).toHaveBeenCalledWith(printPdfDto);
    });
  });

  describe('printText', () => {
    const printTextDto: PrintTextDto = {
      name: 'Fulano de Tal',
      nickname: 'Fulano',
    };

    it('should print the label immediately and return the result', async () => {
      mockPrintService.printText.mockResolvedValue({
        success: true,
        jobId: 'job-789',
        printer: 'default',
        timestamp: new Date(),
      });

      const result = await controller.printText(printTextDto);

      expect(result.success).toBe(true);
      expect(result.data.jobId).toBe('job-789');
      expect(mockPrintService.printText).toHaveBeenCalledWith(printTextDto);
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

      const result = await controller.healthCheck();

      expect(result.success).toBe(true);
      expect(result.status).toBe('healthy');
      expect(result.data.printers.available).toBe(true);
      expect(result.data.printers.total).toBe(1);
    });
  });
});
