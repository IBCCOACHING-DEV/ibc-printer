import { Module } from '@nestjs/common';
import { PrintController } from './print.controller';
import { PrintService } from './print.service';
import { WindowsPrinterService } from './printers/windows-printer.service';
import { LinuxPrinterService } from './printers/linux-printer.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [PrintController],
  providers: [PrintService, WindowsPrinterService, LinuxPrinterService],
  exports: [PrintService],
})
export class PrintModule {}
