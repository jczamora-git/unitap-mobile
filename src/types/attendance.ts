import type { Student } from './student';
import type { EventOccurrence, OccurrenceParticipant, AttendanceStatus } from './event';

export type ScanResultType =
  | 'ACCEPTED'
  | 'RECORDED'
  | 'DUPLICATE'
  | 'ALREADY_RECORDED'
  | 'INVALID'
  | 'UNREGISTERED'
  | 'NOT_ELIGIBLE'
  | 'SESSION_CLOSED'
  | 'REVOKED_REVIEW_REQUIRED'
  | 'CONFLICT_REQUIRES_RECONCILIATION';

export interface AttendanceScanResult {
  type: ScanResultType;
  message: string;
  student?: Student;
  occurrence?: EventOccurrence;
  participant?: OccurrenceParticipant;
  attendanceStatus?: AttendanceStatus;
  timestamp: string;
  rfidUid: string;
  recordId?: string;
  revocationReason?: string;
}

export interface AttendanceScanLog {
  id: string;
  occurrenceId: string;
  studentId?: string;
  studentName?: string;
  rfidUid: string;
  result: ScanResultType;
  attendanceStatus?: AttendanceStatus;
  timestamp: string;
  note?: string;
}

export interface AttendanceStats {
  expectedCount: number;
  checkedInCount: number; // present + late
  presentCount: number;
  lateCount: number;
  pendingCount: number;
  absentCount: number;
  excusedCount: number;
}
