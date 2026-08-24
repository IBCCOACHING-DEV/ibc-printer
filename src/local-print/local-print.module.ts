import { Module } from '@nestjs/common';
import { PrintModule } from '../print/print.module';
import { LocalPrintJobsService } from './local-print-jobs.service';
import { LocalPrintWorkerService } from './local-print-worker.service';
import { PrinterDirectoryService } from './printer-directory.service';

@Module({
  imports: [PrintModule],
  providers: [LocalPrintJobsService, LocalPrintWorkerService, PrinterDirectoryService],
  exports: [LocalPrintJobsService],
})
export class LocalPrintModule {}
