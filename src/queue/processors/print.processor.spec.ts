import { Test, TestingModule } from '@nestjs/testing';
import { PrintProcessor } from './print.processor';
import { PrintService } from '../../print/print.service';
import { PrintResult } from '../../print/interfaces/print.interface';

const mockPrintService = {
  printPDF: jest.fn(),
  printText: jest.fn(),
};

describe('PrintProcessor', () => {
  let processor: PrintProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintProcessor,
        {
          provide: PrintService,
          useValue: mockPrintService,
        },
      ],
    }).compile();

    processor = module.get<PrintProcessor>(PrintProcessor);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(processor).toBeDefined();
  });

  describe('handlePdfPrint', () => {
    it('should process PDF job successfully', async () => {
      const mockJob = {
        id: 'job-123',
        data: {
          type: 'pdf',
          data: { pdfData: 'test-base64' },
          requestId: 'req-456',
        },
        progress: jest.fn(),
      } as any;

      const mockResult: PrintResult = {
        success: true,
        printer: 'test-printer',
        timestamp: new Date(),
      };

      mockPrintService.printPDF.mockResolvedValue(mockResult);

      const result = await processor.handlePdfPrint(mockJob);

      expect(result).toEqual(mockResult);
      expect(mockPrintService.printPDF).toHaveBeenCalledWith(mockJob.data.data);
      expect(mockJob.progress).toHaveBeenCalledWith(10);
      expect(mockJob.progress).toHaveBeenCalledWith(100);
    });

    it('should throw error when PDF print fails', async () => {
      const mockJob = {
        id: 'job-123',
        data: {
          type: 'pdf',
          data: { pdfData: 'test-base64' },
          requestId: 'req-456',
        },
        progress: jest.fn(),
      } as any;

      const mockResult: PrintResult = {
        success: false,
        error: 'Print failed',
        printer: 'test-printer',
        timestamp: new Date(),
      };

      mockPrintService.printPDF.mockResolvedValue(mockResult);

      await expect(processor.handlePdfPrint(mockJob)).rejects.toThrow(
        'Print failed',
      );
    });
  });

  describe('handleTextPrint', () => {
    it('should process text job successfully', async () => {
      const mockJob = {
        id: 'job-456',
        data: {
          type: 'text',
          data: { text: 'test content' },
          requestId: 'req-789',
        },
        progress: jest.fn(),
      } as any;

      const mockResult: PrintResult = {
        success: true,
        printer: 'test-printer',
        timestamp: new Date(),
      };

      mockPrintService.printText.mockResolvedValue(mockResult);

      const result = await processor.handleTextPrint(mockJob);

      expect(result).toEqual(mockResult);
      expect(mockPrintService.printText).toHaveBeenCalledWith(
        mockJob.data.data,
      );
    });
  });
});
