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
import nodeHtmlToImage from 'node-html-to-image';
import * as path from 'path';

const execAsync = promisify(exec);

@Injectable()
export class LinuxPrinterService implements IPrinterService {
  private readonly logger = new Logger(LinuxPrinterService.name);

  async getPrinters(): Promise<PrinterInfo[]> {
    const { stdout } = await execAsync('LC_ALL=C lpstat -p');

    const printers: PrinterInfo[] = [];

    stdout
      .split('\n')
      .filter((line) => line.startsWith('printer '))
      .forEach((line) => {
        const name = line.split(' ')[1];

        printers.push({
          name,
          isDefault: false,
          status: line.includes('enabled') ? 'ready' : 'disabled',
          isOnline: !line.includes('disabled'),
          description: line,
        });
      });

    const defaultPrinter = await this.getDefaultPrinter();
    printers.forEach((p) => {
      p.isDefault = p.name === defaultPrinter;
    });

    return printers;
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Falha ao imprimir PDF: ${errorMessage}`);
    }
  }

  async printText(
    name: string,
    nickname: string,
    printerName: string,
    copies: number = 1,
    course?: string,
  ): Promise<PrintResult> {
    const tempFileName = `print_${Date.now()}.png`;
    const tempImagePath = path.join(process.cwd(), tempFileName);

    try {
      await nodeHtmlToImage({
        output: tempImagePath,
        html: `
        <html>
          <head>
            <style>
              body { 
                width: 3000px;     
                background-color: white;
                padding: 0px;
                magin: 0px;
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                justify-content: flex-start;
              }
              .container { 
                text-align: left; 
                margin-left: 0px; 
              }
              .name { 
                font-size: 150px; 
                color: black;
                margin-bottom: 10px;
                font-family: Arial, sans-serif;
              }
              .nickname { 
                font-size: 200px; 
                font-weight: bold; 
                color: #333; 
                font-family: Arial, sans-serif;
              }
              .course {
                font-size: 150px;
                color: black;
                font-family: Arial, sans-serif;
              }
            </style>
          </head>
          <body>
            <div class="container">
            <div class="nickname">${nickname}</div>
              <div class="name">${name}</div>
              ${course ? `<div class="course">${course}</div>` : ''}
            </div>
          </body>
        </html>
      `,
        puppeteerArgs: { args: ['--no-sandbox, --disable-setuid-sandbox'] },
      });

      const command = `lp -d "${printerName}" -n ${copies} -o orientation-requested=4 -o position=top-left "${tempImagePath}"`;
      const { stdout } = await execAsync(command);

      const jobId = this.extractJobId(stdout);

      if (fs.existsSync(tempImagePath)) {
        fs.unlinkSync(tempImagePath);
      }

      return {
        success: true,
        jobId,
        printer: printerName,
        timestamp: new Date(),
      };
    } catch (error) {
      if (fs.existsSync(tempImagePath)) fs.unlinkSync(tempImagePath);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Falha ao imprimir: ${errorMessage}`);
    }
  }

  async getDefaultPrinter(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        'lpstat -d 2>/dev/null || echo "No default"',
      );

      if (stdout.includes('No default') || !stdout.includes(':')) {
        const { stdout: printersOutput } = await execAsync('LC_ALL=C lpstat -p');
        const firstPrinterLine = printersOutput
          .split('\n')
          .find((line) => line.startsWith('printer '));

        return firstPrinterLine?.split(' ')[1] || 'PDF';
      }

      const parts = stdout.split(':');
      return parts[1]?.trim() || 'PDF';
    } catch (error) {
      this.logger.warn('Não foi possível obter impressora padrão:', error);
      return 'PDF';
    }
  }

  private extractJobId(output: string): string {
    const match = output.match(/request id is ([^\s]+)/i);
    return match ? match[1] : `linux-${Date.now()}`;
  }
}
