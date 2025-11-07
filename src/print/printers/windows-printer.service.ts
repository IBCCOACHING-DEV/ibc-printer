import { Injectable, Logger } from '@nestjs/common';
import {
  IPrinterService,
  PrinterInfo,
  PrintResult,
} from './base-printer.interface';
import * as temp from 'temp';
import * as fs from 'fs-extra';

@Injectable()
export class WindowsPrinterService implements IPrinterService {
  private readonly logger = new Logger(WindowsPrinterService.name);
  private printer: any;

  constructor() {
    this.loadPrinterLibrary();
  }

  private async loadPrinterLibrary() {
    try {
      this.printer = await import('node-printer');
    } catch (error) {
      throw new Error('node-printer não disponível no Windows');
    }
  }

  async getPrinters(): Promise<PrinterInfo[]> {
    await this.loadPrinterLibrary();

    try {
      const printers = this.printer.getPrinters();
      return printers.map((p: any) => ({
        name: p.name,
        isDefault: p.isDefault,
        status: p.status || 'unknown',
        isOnline: this.isPrinterOnline(p.status),
        description: p.description,
      }));
    } catch (error) {
      this.logger.error('Erro ao listar impressoras Windows:', error);
      throw error;
    }
  }

  async printPDF(
    pdfBuffer: Buffer,
    printerName: string,
    copies: number = 1,
  ): Promise<PrintResult> {
    await this.loadPrinterLibrary();

    return new Promise((resolve, reject) => {
      try {
        const tempFile = temp.openSync({ suffix: '.pdf' });
        fs.writeFileSync(tempFile.path, pdfBuffer);

        const printJob = {
          document: tempFile.path,
          printer: printerName,
          type: 'PDF',
          success: (jobID: string) => {
            this.logger.log(
              `PDF impresso no Windows - Job: ${jobID}, Impressora: ${printerName}`,
            );

            setTimeout(() => fs.unlinkSync(tempFile.path), 30000);

            resolve({
              success: true,
              jobId: jobID,
              printer: printerName,
              timestamp: new Date(),
            });
          },
          error: (err: Error) => {
            fs.unlinkSync(tempFile.path);
            reject(err);
          },
        };

        this.printer.print(printJob);
      } catch (error) {
        reject(error);
      }
    });
  }

  async printText(
    text: string,
    printerName: string,
    copies: number = 1,
  ): Promise<PrintResult> {
    await this.loadPrinterLibrary();

    return new Promise((resolve, reject) => {
      try {
        const printJob = {
          data: text,
          printer: printerName,
          type: 'TEXT',
          success: (jobID: string) => {
            this.logger.log(
              `Texto impresso no Windows - Job: ${jobID}, Impressora: ${printerName}`,
            );
            resolve({
              success: true,
              jobId: jobID,
              printer: printerName,
              timestamp: new Date(),
            });
          },
          error: (err: Error) => {
            reject(err);
          },
        };

        this.printer.print(printJob);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getDefaultPrinter(): Promise<string> {
    await this.loadPrinterLibrary();

    const defaultPrinter = this.printer.getDefaultPrinterName();
    if (!defaultPrinter) {
      throw new Error('Nenhuma impressora padrão configurada no Windows');
    }
    return defaultPrinter;
  }

  private isPrinterOnline(status: string): boolean {
    if (!status) return false;
    return (
      status.toLowerCase().includes('ready') ||
      status.toLowerCase().includes('online') ||
      status.toLowerCase().includes('idle')
    );
  }
}
