import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { PrintModule } from './print/print.module';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { MessagingModule } from './messaging/messaging.module';
import { StudentsModule } from './students/students.module';
import { LocalPrintModule } from './local-print/local-print.module';
import { OutboxModule } from './outbox/outbox.module';
import { CheckinModule } from './checkin/checkin.module';
import { AuthSyncModule } from './auth-sync/auth-sync.module';
import { PaiSyncModule } from './pai-sync/pai-sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [configuration],
      isGlobal: true,
    }),
    // Habilita os workers/cron do NestJS (@Interval/@Cron) usados pelo
    // Outbox publisher e pelo worker de impressão local.
    ScheduleModule.forRoot(),
    // Banco local (SQLite/WAL) e mensageria (RabbitMQ) do Checkin Pocket.
    DatabaseModule,
    MessagingModule,
    AuthModule,
    // Impressão local direta (sem fila/Redis) — usada tanto pelos
    // endpoints manuais de teste quanto pelo worker de print_jobs.
    PrintModule,
    // Fluxo principal de credenciamento (Checkin Pocket).
    StudentsModule,
    LocalPrintModule,
    OutboxModule,
    CheckinModule,
    // Sincronização de auth (cache de Operator) e de Courses/Students a
    // partir do banco do Checkin Pai (leitura direta, ver database/).
    AuthSyncModule,
    PaiSyncModule,
  ],
})
export class AppModule {}
