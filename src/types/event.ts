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

export interface EventOccurrence {
  id: string;
  eventId: string;
  title: string; // e.g. "Morning Session", "Afternoon Session"
  date: string; // "YYYY-MM-DD"
  startTime: string; // "08:00"
  endTime: string; // "12:00"
  gracePeriodMinutes: number; // default 15
  status: OccurrenceStatus;
  openedAt?: string;
  closedAt?: string;
  createdAt: string;
}

export type AttendanceStatus = 'PENDING' | 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

export type AttendanceMethod = 'NFC' | 'MANUAL';

export interface OccurrenceParticipant {
  id: string;
  occurrenceId: string;
  eventId: string;
  studentId: string;
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
