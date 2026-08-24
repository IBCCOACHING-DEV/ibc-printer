export interface PaiCourseSummary {
  id: number;
  name: string;
  eventDate: string | null;
  eventHour: string | null;
  eventDateEnd: string | null;
  eventType: string | null;
  eventPlace: string | null;
  /** Quantidade de Students cadastrados nesta turma no Checkin Pai. */
  studentsCount: number;
}
