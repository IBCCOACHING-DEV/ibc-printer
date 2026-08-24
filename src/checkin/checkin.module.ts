import { Module } from '@nestjs/common';
import { StudentsModule } from '../students/students.module';
import { LocalPrintModule } from '../local-print/local-print.module';
import { OutboxModule } from '../outbox/outbox.module';
import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { CheckinSyncConsumer } from './checkin-sync.consumer';

@Module({
  imports: [StudentsModule, LocalPrintModule, OutboxModule],
  controllers: [CheckinController],
  providers: [CheckinService, CheckinSyncConsumer],
})
export class CheckinModule {}
