import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { PrintService } from './print.service';
import { PrintPdfDto } from './dto/print-pdf.dto';
import { PrintTextDto } from './dto/print-text.dto';

jest.mock('node-printer', () => ({
  getPrinters: jest.fn(),
  getDefaultPrinterName: jest.fn(),
  print: jest.fn(),
}));

jest.mock('temp', () => ({
  openSync: jest.fn(() => ({ path: '/tmp/test-file.pdf' })),
}));

jest.mock('fs-extra', () => ({
  writeFile: jest.fn(),
  unlinkSync: jest.fn(),
}));

import * as printer from 'node-printer';
import * as temp from 'temp';
import * as fs from 'fs-extra';

describe('PrintService', () => {
  let service: PrintService;

  const mockPrinters = [
    { name: 'Printer1', isDefault: true, status: 'ready', isOnline: true },
    { name: 'Printer2', isDefault: false, status: 'offline', isOnline: false },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrintService],
    }).compile();

    service = module.get<PrintService>(PrintService);

    jest.clearAllMocks();

    (printer.getPrinters as jest.Mock).mockReturnValue(mockPrinters);
    (printer.getDefaultPrinterName as jest.Mock).mockReturnValue('Printer1');
    (printer.print as jest.Mock).mockImplementation((job) => {
      if (job.success) job.success('job-123');
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPrinters', () => {
    it('should return list of printers', async () => {
      const result = await service.getPrinters();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Printer1');
      expect(result[0].isDefault).toBe(true);
      expect(printer.getPrinters).toHaveBeenCalled();
    });

    it('should return empty array on error', async () => {
      (printer.getPrinters as jest.Mock).mockImplementation(() => {
        throw new Error('Printer error');
      });

      const result = await service.getPrinters();

      expect(result).toEqual([]);
    });
  });

  describe('printPDF', () => {
    const printPdfDto: PrintPdfDto = {
      pdfData:
        'JVBERi0xLjUKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCg==', // PDF base64 mock
      printerName: 'Printer1',
      copies: 1,
      paperSize: 'A4',
    };

    it('should print PDF successfully', async () => {
      const result = await service.printPDF(printPdfDto);

      expect(result.success).toBe(true);
      expect(result.printer).toBe('Printer1');
      expect(fs.writeFile).toHaveBeenCalled();
      expect(printer.print).toHaveBeenCalled();
    });

    it('should use default printer when none specified', async () => {
      const dtoWithoutPrinter = { ...printPdfDto, printerName: undefined };

      const result = await service.printPDF(dtoWithoutPrinter);

      expect(result.printer).toBe('Printer1');
    });

    it('should handle print errors', async () => {
      (printer.print as jest.Mock).mockImplementation((job) => {
        if (job.error) job.error(new Error('Print failed'));
      });

      const result = await service.printPDF(printPdfDto);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Print failed');
    });
  });

  describe('printText', () => {
    const printTextDto: PrintTextDto = {
      text: 'Test print content',
      printerName: 'Printer1',
      copies: 1,
    };

    it('should print text successfully', async () => {
      const result = await service.printText(printTextDto);

      expect(result.success).toBe(true);
      expect(printer.print).toHaveBeenCalled();
    });

    it('should handle text print errors', async () => {
      (printer.print as jest.Mock).mockImplementation((job) => {
        if (job.error) job.error(new Error('Text print failed'));
      });

      const result = await service.printText(printTextDto);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Text print failed');
    });
  });

  describe('validatePrinter', () => {
    it('should return true for existing printer', async () => {
      const isValid = await service.validatePrinter('Printer1');

      expect(isValid).toBe(true);
    });

    it('should return false for non-existing printer', async () => {
      const isValid = await service.validatePrinter('NonExistentPrinter');

      expect(isValid).toBe(false);
    });
  });
});
