import { Module } from '@nestjs/common';
import { PrinterHubService } from './printer-hub.service';
import { PrinterHubController } from './printer-hub.controller';
import { PrintModule } from '../print/print.module';

@Module({
  imports: [PrintModule],
  providers: [PrinterHubService],
  controllers: [PrinterHubController],
})
export class PrinterHubModule {}
