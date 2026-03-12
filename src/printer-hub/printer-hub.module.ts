import { Module } from '@nestjs/common';
import { PrinterHubService } from './printer-hub.service';
import { PrintModule } from '../print/print.module';

@Module({
  imports: [PrintModule],
  providers: [PrinterHubService],
})
export class PrinterHubModule {}
