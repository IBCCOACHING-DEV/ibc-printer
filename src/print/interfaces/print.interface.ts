export interface PrintResult {
  success: boolean;
  jobId?: string;
  error?: string;
  printer: string;
  timestamp: Date;
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
  status: string;
  isOnline: boolean;
}
