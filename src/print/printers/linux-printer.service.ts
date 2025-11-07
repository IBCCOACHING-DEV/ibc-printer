import { Injectable, Logger } from '@nestjs/common';
import {
  IPrinterService,
  PrinterInfo,
  PrintResult,
} from './base-printer.interface';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as temp from 'temp';
import * as fs from 'fs-extra';

const execAsync = promisify(exec);

@Injectable()
export class LinuxPrinterService implements IPrinterService {
  private readonly logger = new Logger(LinuxPrinterService.name);

  async getPrinters(): Promise<PrinterInfo[]> {
    try {
      const { stdout } = await execAsync(
        'lpstat -p 2>/dev/null || echo "No printers"',
      );

      if (stdout.includes('No printers') || stdout.trim() === '') {
        return await this.getPrintersFromCups();
      }

      const printers: PrinterInfo[] = [];
      const lines = stdout.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        if (line.startsWith('printer')) {
          const parts = line.split(' ');
          const name = parts[1];
          const status = line.includes('enabled') ? 'ready' : 'disabled';

          printers.push({
            name,
            isDefault: await this.isDefaultPrinter(name),
            status,
            isOnline: status === 'ready',
            description: line,
          });
        }
      }

      if (printers.length === 0) {
        return await this.getPrintersFromCups();
      }

      return printers;
    } catch (error) {
      this.logger.warn(
        'Erro ao listar impressoras Linux, tentando método alternativo:',
        error,
      );
      return await this.getPrintersFromCups();
    }
  }

  private async getPrintersFromCups(): Promise<PrinterInfo[]> {
    try {
      const { stdout } = await execAsync(
        'lpinfo -v 2>/dev/null || echo "No printers"',
      );

      const printers: PrinterInfo[] = [];
      const lines = stdout.split('\n').filter((line) => line.includes('://'));

      lines.forEach((line) => {
        const parts = line.split(' ');
        if (parts.length >= 2) {
          const device = parts[1];
          const name = device.split('/').pop() || device;

          printers.push({
            name,
            isDefault: printers.length === 0,
            status: 'unknown',
            isOnline: true,
            description: device,
          });
        }
      });

      if (printers.length === 0) {
        printers.push({
          name: 'PDF',
          isDefault: true,
          status: 'ready',
          isOnline: true,
          description: 'Virtual PDF Printer',
        });
      }

      return printers;
    } catch (error) {
      this.logger.error('Falha ao obter impressoras do CUPS:', error);
      throw new Error(
        'Sistema de impressão não disponível no Linux. Instale CUPS: sudo apt install cups',
      );
    }
  }

  async printPDF(
    pdfBuffer: Buffer,
    printerName: string,
    copies: number = 1,
  ): Promise<PrintResult> {
    const tempFile = temp.openSync({ suffix: '.pdf' });
    await fs.writeFile(tempFile.path, pdfBuffer);

    try {
      const command = `lp -d "${printerName}" -n ${copies} "${tempFile.path}"`;
      const { stdout } = await execAsync(command);

      const jobId = this.extractJobId(stdout);

      this.logger.log(
        `PDF enviado para impressão Linux - Job: ${jobId}, Impressora: ${printerName}`,
      );

      setTimeout(() => fs.unlinkSync(tempFile.path), 30000);

      return {
        success: true,
        jobId,
        printer: printerName,
        timestamp: new Date(),
      };
    } catch (error) {
      fs.unlinkSync(tempFile.path);
      throw new Error(`Falha ao imprimir PDF: ${error.message}`);
    }
  }

  async printText(
    text: string,
    printerName: string,
    copies: number = 1,
  ): Promise<PrintResult> {
    try {
      const command = `printf "%s" "${this.escapeText(text)}" | lp -d "${printerName}" -n ${copies}`;
      const { stdout } = await execAsync(command);

      const jobId = this.extractJobId(stdout);

      this.logger.log(
        `Texto enviado para impressão Linux - Job: ${jobId}, Impressora: ${printerName}`,
      );

      return {
        success: true,
        jobId,
        printer: printerName,
        timestamp: new Date(),
      };
    } catch (error) {
      throw new Error(`Falha ao imprimir texto: ${error.message}`);
    }
  }

  async getDefaultPrinter(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        'lpstat -d 2>/dev/null || echo "No default"',
      );

      if (stdout.includes('No default') || !stdout.includes(':')) {
        const printers = await this.getPrinters();
        const defaultPrinter = printers.find((p) => p.isDefault);
        return defaultPrinter?.name || printers[0]?.name || 'PDF';
      }

      const parts = stdout.split(':');
      return parts[1]?.trim() || 'PDF';
    } catch (error) {
      this.logger.warn('Não foi possível obter impressora padrão:', error);
      const printers = await this.getPrinters();
      return printers[0]?.name || 'PDF';
    }
  }

  private async isDefaultPrinter(printerName: string): Promise<boolean> {
    try {
      const defaultPrinter = await this.getDefaultPrinter();
      return defaultPrinter === printerName;
    } catch {
      return false;
    }
  }

  private extractJobId(output: string): string {
    const match = output.match(/request id is ([^\s]+)/i);
    return match ? match[1] : `linux-${Date.now()}`;
  }

  private escapeText(text: string): string {
    return text
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`')
      .replace(/\n/g, '\\n');
  }
}
