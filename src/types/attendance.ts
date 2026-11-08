import type { Student } from './student';
import type { EventOccurrence, OccurrenceParticipant, AttendanceStatus, CheckpointType } from './event';

export type ScanResultType =
  | 'ACCEPTED'
  | 'RECORDED'
  | 'DUPLICATE'
  | 'ALREADY_RECORDED'
  | 'INVALID'
  | 'UNREGISTERED'
  | 'NOT_ELIGIBLE'
  | 'SESSION_CLOSED'
  | 'CHECKPOINT_NOT_OPEN'
  | 'CHECKPOINT_CLOSED'
  | 'REVOKED_REVIEW_REQUIRED'
  | 'CONFLICT_REQUIRES_RECONCILIATION';

export interface AttendanceScanResult {
  type: ScanResultType;
  message: string;
  student?: Student;
  studentFullName?: string;
  photoUrl?: string | null;
  photoLocalUri?: string | null;
  occurrence?: EventOccurrence;
  participant?: OccurrenceParticipant;
  attendanceStatus?: AttendanceStatus;
  checkpointId?: string;
  checkpointLabel?: string;
  checkpointType?: CheckpointType;
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
  checkpointId?: string;
  checkpointLabel?: string;
  checkpointType?: CheckpointType;
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
