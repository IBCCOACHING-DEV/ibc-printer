/**
 * Payload publicado no exchange `ibc.checkin.events` quando um check-in é
 * realizado em QUALQUER instância do Checkin Pocket. É consumido por todas
 * as outras instâncias (para sincronizar o SQLite local) e, futuramente,
 * pelo Checkin Pai (Rails) para atualizar o Student remoto.
 */
export interface CheckinPerformedMessage {
  eventId: string;
  studentId: number;
  courseId: number;
  studentName: string;
  courseName: string;
  studentToken: string;
  /** ISO-8601 — instante em que o check-in ocorreu na estação de origem. */
  checkedInAt: string;
  /** agentKey da estação (computador) que realizou o check-in. */
  sourceAgentKey: string;
  /** ISO-8601 — instante em que o evento foi gerado (para auditoria). */
  occurredAt: string;
}

/**
 * Payload publicado no exchange de dead-letter de impressão quando um
 * print_job esgota o número máximo de tentativas.
 */
export interface PrintJobDeadLetterMessage {
  printJobId: number;
  studentId: number | null;
  targetPrinterUid: string;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  sourceAgentKey: string;
  occurredAt: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Valida e converte uma mensagem recebida do RabbitMQ (tipo `unknown`, pois
 * vem de `JSON.parse`) em um `CheckinPerformedMessage` fortemente tipado.
 * Lança erro em caso de payload malformado, o que faz o consumer descartar
 * a mensagem para a dead-letter queue em vez de travar o processamento.
 */
export function parseCheckinPerformedMessage(raw: unknown): CheckinPerformedMessage {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Mensagem de check-in inválida: payload não é um objeto.');
  }

  const candidate = raw as Record<string, unknown>;

  const requiredStringFields: Array<keyof CheckinPerformedMessage> = [
    'eventId',
    'studentName',
    'courseName',
    'studentToken',
    'checkedInAt',
    'sourceAgentKey',
    'occurredAt',
  ];

  for (const field of requiredStringFields) {
    if (!isNonEmptyString(candidate[field])) {
      throw new Error(`Mensagem de check-in inválida: campo "${field}" ausente ou vazio.`);
    }
  }

  if (typeof candidate.studentId !== 'number' || !Number.isFinite(candidate.studentId)) {
    throw new Error('Mensagem de check-in inválida: "studentId" ausente ou não numérico.');
  }

  if (typeof candidate.courseId !== 'number' || !Number.isFinite(candidate.courseId)) {
    throw new Error('Mensagem de check-in inválida: "courseId" ausente ou não numérico.');
  }

  return {
    eventId: candidate.eventId as string,
    studentId: candidate.studentId,
    courseId: candidate.courseId,
    studentName: candidate.studentName as string,
    courseName: candidate.courseName as string,
    studentToken: candidate.studentToken as string,
    checkedInAt: candidate.checkedInAt as string,
    sourceAgentKey: candidate.sourceAgentKey as string,
    occurredAt: candidate.occurredAt as string,
  };
}
