export interface CourseSyncResult {
  courseId: number;
  courseName: string;
  /** Total de Students encontrados para esta turma no Checkin Pai. */
  totalStudents: number;
  /** Quantos foram gravados/atualizados na réplica local. */
  synced: number;
  /** Quantos foram ignorados (sem nome ou sem token — não localizáveis via QR Code). */
  skipped: number;
}
