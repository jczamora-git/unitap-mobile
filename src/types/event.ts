export type EventType =
  | 'Cleanup Drive'
  | 'IT Day'
  | 'Sportsfest'
  | 'General Assembly'
  | 'Orientation'
  | 'Seminar'
  | 'Other'
  | (string & Record<never, never>);

export type AudienceType = 'ALL_BSIT' | 'YEAR_LEVEL' | 'SECTION';

export interface AudienceConfig {
  type: AudienceType;
  yearLevels?: number[]; // e.g. [1, 2]
  sections?: string[]; // e.g. ["BSIT-3A", "BSIT-3B"]
}

export type EventStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface Event {
  id: string;
  title: string;
  description: string;
  type: EventType;
  categoryId?: string;
  semesterId?: string;
  audience: AudienceConfig;
  attendanceRequired: boolean;
  status: EventStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export type OccurrenceStatus = 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED';

export type CheckpointType = 'IN' | 'OUT';

export interface AttendanceCheckpoint {
  id: string; // e.g. "chk_morning_in" or raw UUID
  label: string; // e.g. "Morning IN"
  type: CheckpointType; // 'IN' | 'OUT'
  startTime?: string; // "08:00"
  endTime?: string; // "10:00"
  opensAt?: string; // "07:00" (Scan window opening time)
  closesAt?: string; // "08:30" (On-Time Until / on-time cutoff)
  lateUntil?: string; // "11:30" (Accept Late Until - final cutoff for LATE attendance)
  graceMinutes?: number;
  orderIndex?: number;
}

export interface CheckpointPreset {
  label: string;
  type: CheckpointType;
  opensAt: string;
  closesAt: string;
  lateUntil?: string;
  displayTime?: string;
}

export const CHECKPOINT_PRESETS: readonly CheckpointPreset[] = [
  { label: 'Morning IN', type: 'IN', opensAt: '07:00', closesAt: '08:30', lateUntil: '11:30', displayTime: '7:00 AM – 8:30 AM' },
  { label: 'Morning OUT', type: 'OUT', opensAt: '11:30', closesAt: '12:30', displayTime: '11:30 AM – 12:30 PM' },
  { label: 'Afternoon IN', type: 'IN', opensAt: '12:30', closesAt: '13:30', lateUntil: '16:30', displayTime: '12:30 PM – 1:30 PM' },
  { label: 'Afternoon OUT', type: 'OUT', opensAt: '16:30', closesAt: '17:30', displayTime: '4:30 PM – 5:30 PM' },
] as const;

export interface EventOccurrence {
  id: string;
  eventId: string;
  title: string; // e.g. "Morning Session", "Afternoon Session"
  date: string; // "YYYY-MM-DD"
  startTime: string; // "08:00"
  endTime: string; // "12:00"
  gracePeriodMinutes: number; // default 15
  status: OccurrenceStatus;
  checkpoints?: AttendanceCheckpoint[];
  activeCheckpointId?: string | null;
  openedAt?: string;
  closedAt?: string;
  createdAt: string;
}

export type AttendanceStatus = 'PENDING' | 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' | 'VOID' | 'REVOKED';

export type AttendanceMethod = 'NFC' | 'MANUAL';

export interface OccurrenceParticipant {
  id: string;
  occurrenceId: string;
  eventId: string;
  studentId: string;
  checkpointId?: string;
  checkpointLabel?: string;
  checkpointType?: CheckpointType;
  attendanceStatus: AttendanceStatus;
  attendanceTime?: string; // ISO
  attendanceMethod?: AttendanceMethod;
  manualNote?: string;
  updatedAt: string;
}

export interface CreateEventDto {
  title: string;
  description: string;
  type: EventType;
  audience: AudienceConfig;
  attendanceRequired?: boolean;
}

export interface CreateOccurrenceDto {
  eventId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes?: number;
  checkpoints?: AttendanceCheckpoint[];
  activeCheckpointId?: string | null;
}

export interface UpdateOccurrenceDto {
  occurrenceId: string;
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  gracePeriodMinutes?: number;
  checkpoints?: AttendanceCheckpoint[];
  activeCheckpointId?: string | null;
}
