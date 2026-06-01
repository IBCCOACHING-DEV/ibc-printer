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
import QRCode from 'qrcode';

const execAsync = promisify(exec);

@Injectable()
export class WindowsPrinterService implements IPrinterService {
  private readonly logger = new Logger(WindowsPrinterService.name);

  async getPrinters(): Promise<PrinterInfo[]> {
    const { stdout } = await execAsync(
      'powershell -Command "Get-CimInstance Win32_Printer | Select-Object Name, Default, PrinterStatus, PortName, PNPDeviceID, DriverName | ConvertTo-Json -Compress"',
    );

    const parsed = stdout.trim() ? JSON.parse(stdout.trim()) : [];
    const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];

    return list.map((p) => ({
      name: p.Name,
      systemName: p.Name,
      isDefault: p.Default === true,
      status: String(p.PrinterStatus ?? 'unknown'),
      isOnline: this.isPrinterOnline(
        String(p.PrinterStatus ?? ''),
        String(p.PortName ?? ''),
      ),
      description: `${p.Name} (${String(p.PortName ?? 'unknown-port')})`,
      deviceId: String(p.PNPDeviceID ?? '').trim() || undefined,
    }));
  }

  async printPDF(
    pdfBuffer: Buffer,
    printerName: string,
    copies: number = 1,
  ): Promise<PrintResult> {
    const tempFile = temp.openSync({ suffix: '.pdf' });
    await fs.writeFile(tempFile.path, pdfBuffer);

    try {
      const escapedFilePath = this.escapePowerShellSingleQuoted(tempFile.path);
      const escapedPrinterName = this.escapePowerShellSingleQuoted(printerName);

      for (let i = 0; i < copies; i++) {
        const script =
          `$ErrorActionPreference='Stop'; ` +
          `Start-Process -FilePath '${escapedFilePath}' -Verb PrintTo -ArgumentList '${escapedPrinterName}' -Wait -WindowStyle Hidden;`;
        await this.execPowerShell(script);
      }

      const jobId = `win-${Date.now()}`;

      this.logger.log(
        `PDF enviado para impressão Windows - Job: ${jobId}, Impressora: ${printerName}`,
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
    studentId?: number,
  ): Promise<PrintResult> {
    const tempFileName = `print_${Date.now()}.png`;
    const tempImagePath = path.join(process.cwd(), tempFileName);
    const qrCodeDataUrl = await this.buildQrCodeDataUrl(studentId);
    const safeName = this.escapeHtml(name);
    const safeNickname = this.escapeHtml(nickname);
    const safeCourse = this.escapeHtml(course);
    const safeStudentId = this.escapeHtml(studentId?.toString());

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
                margin: 0px;
              }
              .container { 
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 70px;
              }
              .text-content {
                text-align: left;
                flex: 1;
              }
              .name { 
                font-size: 170px; 
                color: black;
                margin-bottom: 10px;
                font-family: Arial, sans-serif;
              }
              .nickname { 
                font-size: 230px; 
                font-weight: bold; 
                color: #333; 
                font-family: Arial, sans-serif;
              }
              .course {
                font-size: 120px;
                color: #666;
                font-family: Arial, sans-serif;
              }
              .qr-content {
                width: 250px;
                text-align: center;
              }
              .qr-image {
                width: 220px;
                height: 220px;
              }
              .qr-id {
                margin-top: 10px;
                font-family: Arial, sans-serif;
                font-size: 42px;
                color: black;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="text-content">
                <div class="nickname">${safeNickname}</div>
                <div class="name">${safeName}</div>
                ${safeCourse ? `<div class="course">${safeCourse}</div>` : ''}
              </div>
              ${qrCodeDataUrl ? `<div class="qr-content"><img class="qr-image" src="${qrCodeDataUrl}" alt="QR Code" /><div class="qr-id">ID ${safeStudentId}</div></div>` : ''}
            </div>
          </body>
        </html>
      `,
        puppeteerArgs: { args: ['--no-sandbox, --disable-setuid-sandbox'] },
      });

      const escapedImagePath = this.escapePowerShellSingleQuoted(tempImagePath);
      const escapedPrinterName = this.escapePowerShellSingleQuoted(printerName);

      for (let i = 0; i < copies; i++) {
        const script =
          `$ErrorActionPreference='Stop'; ` +
          `Add-Type -AssemblyName System.Drawing; ` +
          `$img = [System.Drawing.Image]::FromFile('${escapedImagePath}'); ` +
          `try { ` +
          `  $pd = New-Object System.Drawing.Printing.PrintDocument; ` +
          `  $pd.PrinterSettings.PrinterName = '${escapedPrinterName}'; ` +
          `  $pd.DefaultPageSettings.Landscape = ($img.Width -gt $img.Height); ` +
          `  $pd.OriginAtMargins = $false; ` +
          `  $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0); ` +
          `  $pd.add_PrintPage({ ` +
          `    param($s, $e) ` +
          `    $bounds = $e.PageBounds; ` +
          `    $imgW = [double]$img.Width; ` +
          `    $imgH = [double]$img.Height; ` +
          `    $scale = [Math]::Min($bounds.Width / $imgW, $bounds.Height / $imgH); ` +
          `    $drawW = [int]($imgW * $scale); ` +
          `    $drawH = [int]($imgH * $scale); ` +
          `    $x = [int](($bounds.Width - $drawW) / 2); ` +
          `    $y = [int](($bounds.Height - $drawH) / 2); ` +
          `    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; ` +
          `    $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality; ` +
          `    $e.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality; ` +
          `    $rect = New-Object System.Drawing.Rectangle($x, $y, $drawW, $drawH); ` +
          `    $e.Graphics.DrawImage($img, $rect); ` +
          `  }); ` +
          `  $pd.Print(); ` +
          `} finally { ` +
          `  if ($pd) { $pd.Dispose() }; ` +
          `  $img.Dispose() ` +
          `}`;
        await this.execPowerShell(script);
      }

      const jobId = `win-${Date.now()}`;

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
        'powershell -Command "(Get-WmiObject -Query \\"SELECT * FROM Win32_Printer WHERE Default=True\\").Name"',
      );

      const name = stdout.trim();
      if (!name) {
        throw new Error('Nenhuma impressora padrão configurada no Windows');
      }
      return name;
    } catch (error) {
      this.logger.warn('Não foi possível obter impressora padrão:', error);
      return 'PDF';
    }
  }

  private isPrinterOnline(status: string, portName: string): boolean {
    const normalizedStatus = String(status || '').toLowerCase();
    const normalizedPort = String(portName || '').toLowerCase();

    if (this.isLocalPort(normalizedPort)) {
      return true;
    }

    if (!normalizedStatus) {
      return true;
    }

    if (
      normalizedStatus.includes('offline') ||
      normalizedStatus.includes('error') ||
      normalizedStatus.includes('not available') ||
      normalizedStatus === '7' ||
      normalizedStatus === '128'
    ) {
      return false;
    }

    return true;
  }

  private isLocalPort(portName: string): boolean {
    return (
      portName.startsWith('usb') ||
      portName.startsWith('dot4') ||
      portName.startsWith('lpt') ||
      portName.startsWith('com') ||
      portName.startsWith('wsd')
    );
  }

  private async execPowerShell(script: string): Promise<void> {
    const escapedScript = script.replace(/"/g, '\\"');
    const command = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${escapedScript}"`;
    await execAsync(command);
  }

  private escapePowerShellSingleQuoted(value: string): string {
    return String(value || '').replace(/'/g, "''");
  }

  private escapeHtml(value?: string): string {
    if (!value) {
      return '';
    }

    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private async buildQrCodeDataUrl(studentId?: number): Promise<string | null> {
    if (!studentId) {
      return null;
    }

    return QRCode.toDataURL(studentId.toString(), {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 220,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });
  }
}
