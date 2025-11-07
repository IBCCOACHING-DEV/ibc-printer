import { Injectable, Logger } from '@nestjs/common';
import {
  IPrinterService,
  PrinterInfo,
  PrintResult,
} from './printers/base-printer.interface';
import { WindowsPrinterService } from './printers/windows-printer.service';
import { LinuxPrinterService } from './printers/linux-printer.service';
import { PrintPdfDto } from './dto/print-pdf.dto';
import { PrintTextDto } from './dto/print-text.dto';

@Injectable()
export class PrintService {
  private readonly logger = new Logger(PrintService.name);
  private readonly printerService: IPrinterService;

  constructor() {
    this.printerService =
      process.platform === 'win32'
        ? new WindowsPrinterService()
        : new LinuxPrinterService();

    this.logger.log(
      `✅ Serviço de impressão inicializado para: ${process.platform}`,
    );
  }

  async getPrinters(): Promise<PrinterInfo[]> {
    try {
      const printers = await this.printerService.getPrinters();
      this.logger.log(`📋 ${printers.length} impressoras encontradas`);
      return printers;
    } catch (error) {
      this.logger.error('Erro ao listar impressoras:', error);
      throw error;
    }
  }

  async printPDF(printDto: PrintPdfDto): Promise<PrintResult> {
    const printerName =
      printDto.printerName || (await this.printerService.getDefaultPrinter());

    this.logger.log(
      `📄 Iniciando impressão PDF - Plataforma: ${process.platform}, Impressora: ${printerName}`,
    );

    try {
      const pdfBuffer = Buffer.from(printDto.pdfData, 'base64');
      const result = await this.printerService.printPDF(
        pdfBuffer,
        printerName,
        printDto.copies,
      );

      this.logger.log(`✅ PDF impresso com sucesso - Job: ${result.jobId}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Erro na impressão PDF: ${error.message}`);
      return {
        success: false,
        error: error.message,
        printer: printerName,
        timestamp: new Date(),
      };
    }
  }

  async printText(printDto: PrintTextDto): Promise<PrintResult> {
    const printerName =
      printDto.printerName || (await this.printerService.getDefaultPrinter());

    this.logger.log(
      `📝 Iniciando impressão texto - Plataforma: ${process.platform}, Impressora: ${printerName}`,
    );

    try {
      const result = await this.printerService.printText(
        printDto.text,
        printerName,
        printDto.copies,
      );

      this.logger.log(`✅ Texto impresso com sucesso - Job: ${result.jobId}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Erro na impressão texto: ${error.message}`);
      return {
        success: false,
        error: error.message,
        printer: printerName,
        timestamp: new Date(),
      };
    }
  }

  async validatePrinter(printerName: string): Promise<boolean> {
    const printers = await this.getPrinters();
    return printers.some((printer) => printer.name === printerName);
  }

  async getPrinterInfo(printerName: string): Promise<PrinterInfo | null> {
    const printers = await this.getPrinters();
    return printers.find((printer) => printer.name === printerName) || null;
  }

  async getSystemInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      printerService: this.printerService.constructor.name,
      nodeVersion: process.version,
    };
  }
}
