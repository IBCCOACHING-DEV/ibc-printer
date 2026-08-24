export interface CheckinResult {
  success: boolean;
  alreadyCheckedIn?: boolean;
  message: string;
  studentId?: number;
  studentName?: string;
  courseName?: string;
  printJobId?: number;
}
