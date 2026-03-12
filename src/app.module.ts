import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { PrintModule } from './print/print.module';
import { QueueModule } from './queue/queue.module';
import configuration from './config/configuration';
import { PrinterHubModule } from './printer-hub/printer-hub.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    AuthModule,
    PrintModule,
    QueueModule,
    PrinterHubModule,
  ],
})
export class AppModule {}
