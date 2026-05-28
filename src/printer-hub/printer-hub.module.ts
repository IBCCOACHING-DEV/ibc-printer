import { Module } from '@nestjs/common';
import { PrinterHubService } from './printer-hub.service';
import { PrintModule } from '../print/print.module';
import { PrinterHubRepository } from './printer-hub.repository';

@Module({
  imports: [PrintModule],
  providers: [PrinterHubService, PrinterHubRepository],
})
export class PrinterHubModule {}
