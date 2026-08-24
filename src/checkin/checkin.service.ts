import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { LocalPrismaService } from '../database/local-prisma.service';
import { LocalTransactionClient } from '../database/local-prisma.types';
import { StudentsService } from '../students/students.service';
import { LocalPrintJobsService } from '../local-print/local-print-jobs.service';
import { OutboxService } from '../outbox/outbox.service';
import { CHECKIN_PERFORMED_ROUTING_KEY } from '../messaging/rabbitmq.constants';
import { CheckinPerformedMessage } from '../messaging/types';
import { CheckinRequestDto } from './dto/checkin-request.dto';
import { CheckinResult } from './interfaces/checkin-result.interface';

/**
 * Orquestra o fluxo principal de credenciamento (check-in) do Checkin
 * Pocket:
 *
 *  1. Localiza o aluno na réplica local (por token do QR Code).
 *  2. Se já credenciado, retorna idempotentemente (não duplica impressão
 *     nem evento).
 *  3. Em uma ÚNICA transação SQLite:
 *       a. marca o aluno como credenciado;
 *       b. cria o print_job da etiqueta (nome do aluno + nome da turma);
 *       c. grava o evento no outbox_events (Outbox Pattern).
 *  4. A impressão física e a publicação no RabbitMQ acontecem de forma
 *     assíncrona, por workers dedicados (`LocalPrintWorkerService` e
 *     `OutboxPublisherWorker`) — o check-in responde rápido mesmo se a
 *     impressora ou o broker estiverem temporariamente indisponíveis.
 */
@Injectable()
export class CheckinService {
  private readonly logger = new Logger(CheckinService.name);

  constructor(
    private readonly prisma: LocalPrismaService,
    private readonly studentsService: StudentsService,
    private readonly printJobsService: LocalPrintJobsService,
    private readonly outboxService: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  private get agentKey(): string {
    return this.configService.get<string>('checkinAgent.agentKey', 'unknown-agent');
  }

  private get defaultPrinterUid(): string {
    return this.configService.get<string>('print.defaultPrinter', '');
  }

  async performCheckin(dto: CheckinRequestDto): Promise<CheckinResult> {
    const student = await this.studentsService.findByToken(dto.studentToken);

    if (!student) {
      return {
        success: false,
        message: 'Aluno não encontrado na base local. Sincronize os ingressos antes do check-in.',
      };
    }

    // Mesma validação do Checkin Pai (CheckinProcessorService): se uma
    // turma foi selecionada na tela de check-in, o aluno precisa pertencer
    // a ela — evita credenciar por engano na turma errada quando há mais
    // de uma turma sincronizada nesta estação.
    if (dto.courseId !== undefined && student.courseId !== dto.courseId) {
      return {
        success: false,
        message: 'Aluno não pertence à turma selecionada.',
      };
    }

    if (student.checkedIn) {
      return {
        success: true,
        alreadyCheckedIn: true,
        message: 'Aluno já credenciado anteriormente.',
        studentId: student.id,
        studentName: student.name,
        courseName: student.courseName,
      };
    }

    const checkedInAt = new Date();
    const printerUid = dto.printerUid?.trim() || this.defaultPrinterUid;
    const idempotencyKey = `pocket-${this.agentKey}-${student.id}-${randomUUID()}`;

    const printJobId = await this.prisma.$transaction(async (tx: LocalTransactionClient) => {
      await this.studentsService.markCheckedIn(tx, student.id, checkedInAt);

      const printJob = await this.printJobsService.createPendingJob(tx, {
        studentId: student.id,
        courseId: student.courseId,
        targetPrinterUid: printerUid,
        labelName: student.name,
        labelCourseName: student.courseName,
        idempotencyKey,
      });

      const message: CheckinPerformedMessage = {
        eventId: randomUUID(),
        studentId: student.id,
        courseId: student.courseId,
        studentName: student.name,
        courseName: student.courseName,
        studentToken: student.token,
        checkedInAt: checkedInAt.toISOString(),
        sourceAgentKey: this.agentKey,
        occurredAt: new Date().toISOString(),
      };

      await this.outboxService.record(tx, {
        aggregateType: 'student_checkin',
        aggregateId: String(student.id),
        eventType: 'student.checked_in',
        routingKey: CHECKIN_PERFORMED_ROUTING_KEY,
        payload: message,
      });

      return printJob.id;
    });

    this.logger.log(
      `Check-in realizado — aluno=${student.id} (${student.name}) turma="${student.courseName}" print_job=${printJobId}.`,
    );

    return {
      success: true,
      message: 'Check-in realizado com sucesso.',
      studentId: student.id,
      studentName: student.name,
      courseName: student.courseName,
      printJobId,
    };
  }
}
