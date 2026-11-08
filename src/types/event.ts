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
  graceMinutes?: number;
  orderIndex?: number;
}

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
}
