import { SrvRecord } from 'dns';

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status: string;
  isOnline: boolean;
  description?: string;
}

export interface PrintResult {
  success: boolean;
  jobId?: string;
  error?: string;
  printer: string;
  timestamp: Date;
}

export interface IPrinterService {
  getPrinters(): Promise<PrinterInfo[]>;
  printPDF(
    pdfBuffer: Buffer,
    printerName: string,
    copies?: number,
  ): Promise<PrintResult>;
  printText(
    name: string,
    nickname: string,
    printerName: string,
    copies?: number,
    course?: string,
  ): Promise<PrintResult>;
  getDefaultPrinter(): Promise<string>;
}
