import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { PrintService } from '../../print/print.service';
import { PrintJobData } from '../queue.service';

@Injectable()
@Processor('print')
export class PrintProcessor {
  private readonly logger = new Logger(PrintProcessor.name);

  constructor(private readonly printService: PrintService) {}

  @Process('pdf')
  async handlePdfPrint(job: Job<PrintJobData>) {
    this.logger.log(
      `[PDF] Processando job ${job.id} - Request: ${job.data.requestId}`,
    );

    try {
      await job.progress(10);

      const result = await this.printService.printPDF(job.data.data as any);

      await job.progress(100);

      if (!result.success) {
        throw new Error(result.error || 'Erro desconhecido na impressão PDF');
      }

      this.logger.log(`[PDF] Job ${job.id} concluído com sucesso`);
      return result;
    } catch (error) {
      this.logger.error(`[PDF] Falha no job ${job.id}:`, error);
      throw error;
    }
  }

  @Process('text')
  async handleTextPrint(job: Job<PrintJobData>) {
    this.logger.log(
      `[TEXT] Processando job ${job.id} - Request: ${job.data.requestId}`,
    );

    try {
      await job.progress(10);

      const result = await this.printService.printText(job.data.data as any);

      await job.progress(100);

      if (!result.success) {
        throw new Error(result.error || 'Erro desconhecido na impressão texto');
      }

      this.logger.log(`[TEXT] Job ${job.id} concluído com sucesso`);
      return result;
    } catch (error) {
      this.logger.error(`[TEXT] Falha no job ${job.id}:`, error);
      throw error;
    }
  }
}
