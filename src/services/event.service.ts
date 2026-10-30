import type { 
  Event, 
  EventOccurrence, 
  OccurrenceParticipant, 
  CreateEventDto, 
  CreateOccurrenceDto,
  AttendanceStatus 
} from '@/types/event';
import type { AttendanceStats } from '@/types/attendance';
import { localEventRepository, type IEventRepository } from '@/storage/event-storage.service';
import { studentService } from '@/services/student.service';

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export class EventService {
  constructor(private repo: IEventRepository = localEventRepository) {}

  async getEvents(): Promise<Event[]> {
    return this.repo.getEvents();
  }

  async getEvent(id: string): Promise<Event | null> {
    return this.repo.getEventById(id);
  }

  async createEvent(dto: CreateEventDto): Promise<Event> {
    if (!dto.title || !dto.title.trim()) {
      throw new Error('Event Title is required.');
    }
    if (!dto.type) {
      throw new Error('Event Type is required.');
    }
    if (!dto.audience || !dto.audience.type) {
      throw new Error('Event Audience must be configured.');
    }

    const now = new Date().toISOString();
    const newEvent: Event = {
      id: generateId('evt'),
      title: dto.title.trim(),
      description: dto.description?.trim() || '',
      type: dto.type,
      audience: dto.audience,
      attendanceRequired: dto.attendanceRequired ?? true,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now
    };

    return this.repo.saveEvent(newEvent);
  }

  async updateEvent(id: string, updates: Partial<Event>): Promise<Event> {
    const existing = await this.getEvent(id);
    if (!existing) {
      throw new Error('Event not found.');
    }

    const updated: Event = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date().toISOString()
    };

    return this.repo.saveEvent(updated);
  }

  async deleteEvent(id: string): Promise<void> {
    return this.repo.deleteEvent(id);
  }

  async getOccurrences(eventId?: string): Promise<EventOccurrence[]> {
    return this.repo.getOccurrences(eventId);
  }

  async getOccurrence(id: string): Promise<EventOccurrence | null> {
    return this.repo.getOccurrenceById(id);
  }

  async createOccurrence(dto: CreateOccurrenceDto): Promise<EventOccurrence> {
    const event = await this.getEvent(dto.eventId);
    if (!event) {
      throw new Error('Parent event does not exist.');
    }
    if (!dto.title || !dto.title.trim()) {
      throw new Error('Occurrence Session Title is required.');
    }
    if (!dto.date) {
      throw new Error('Session Date is required.');
    }
    if (!dto.startTime || !dto.endTime) {
      throw new Error('Start Time and End Time are required.');
    }

    const now = new Date().toISOString();
    const occurrence: EventOccurrence = {
      id: generateId('occ'),
      eventId: dto.eventId,
      title: dto.title.trim(),
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      gracePeriodMinutes: dto.gracePeriodMinutes ?? 15,
      status: 'SCHEDULED',
      createdAt: now
    };

    return this.repo.saveOccurrence(occurrence);
  }

  async openOccurrence(occurrenceId: string): Promise<EventOccurrence> {
    const occurrence = await this.getOccurrence(occurrenceId);
    if (!occurrence) {
      throw new Error('Occurrence session not found.');
    }
    if (occurrence.status === 'CLOSED') {
      throw new Error('Cannot reopen a closed occurrence.');
    }

    const event = await this.getEvent(occurrence.eventId);
    if (!event) {
      throw new Error('Event not found.');
    }

    // Generate expected participants if not already populated
    const existingParticipants = await this.repo.getParticipants(occurrenceId);
    if (existingParticipants.length === 0) {
      await this.generateExpectedParticipants(event, occurrenceId);
    }

    occurrence.status = 'OPEN';
    occurrence.openedAt = new Date().toISOString();
    return this.repo.saveOccurrence(occurrence);
  }

  async closeOccurrence(occurrenceId: string): Promise<EventOccurrence> {
    const occurrence = await this.getOccurrence(occurrenceId);
    if (!occurrence) {
      throw new Error('Occurrence session not found.');
    }

    const now = new Date().toISOString();
    occurrence.status = 'CLOSED';
    occurrence.closedAt = now;

    // Convert any remaining PENDING participants to ABSENT
    const participants = await this.repo.getParticipants(occurrenceId);
    const updatedParticipants = participants.map(p => {
      if (p.attendanceStatus === 'PENDING') {
        return {
          ...p,
          attendanceStatus: 'ABSENT' as AttendanceStatus,
          updatedAt: now
        };
      }
      return p;
    });

    await this.repo.saveParticipants(updatedParticipants);
    return this.repo.saveOccurrence(occurrence);
  }

  async generateExpectedParticipants(event: Event, occurrenceId: string): Promise<OccurrenceParticipant[]> {
    const allStudents = await studentService.getStudents();
    const audience = event.audience;

    // Filter students by audience rules
    const eligibleStudents = allStudents.filter(s => {
      // Must be active student
      if (s.status && s.status !== 'ACTIVE') return false;

      if (audience.type === 'ALL_BSIT') {
        return (s.course || 'BSIT').toUpperCase() === 'BSIT';
      }
      if (audience.type === 'YEAR_LEVEL' && audience.yearLevels && audience.yearLevels.length > 0) {
        return audience.yearLevels.includes(s.yearLevel);
      }
      if (audience.type === 'SECTION' && audience.sections && audience.sections.length > 0) {
        return audience.sections.some(sec => sec.toLowerCase() === (s.section || '').toLowerCase());
      }
      return true;
    });

    const now = new Date().toISOString();
    const participants: OccurrenceParticipant[] = eligibleStudents.map(s => ({
      id: generateId('part'),
      occurrenceId,
      eventId: event.id,
      studentId: s.id,
      attendanceStatus: 'PENDING',
      updatedAt: now
    }));

    await this.repo.saveParticipants(participants);
    return participants;
  }

  async getOccurrenceStats(occurrenceId: string): Promise<AttendanceStats> {
    const participants = await this.repo.getParticipants(occurrenceId);
    let presentCount = 0;
    let lateCount = 0;
    let pendingCount = 0;
    let absentCount = 0;
    let excusedCount = 0;

    participants.forEach(p => {
      switch (p.attendanceStatus) {
        case 'PRESENT':
          presentCount++;
          break;
        case 'LATE':
          lateCount++;
          break;
        case 'PENDING':
          pendingCount++;
          break;
        case 'ABSENT':
          absentCount++;
          break;
        case 'EXCUSED':
          excusedCount++;
          break;
      }
    });

    return {
      expectedCount: participants.length,
      checkedInCount: presentCount + lateCount,
      presentCount,
      lateCount,
      pendingCount,
      absentCount,
      excusedCount
    };
  }

  async getParticipants(occurrenceId?: string): Promise<OccurrenceParticipant[]> {
    return this.repo.getParticipants(occurrenceId);
  }

  async updateParticipantStatus(
    participantId: string, 
    status: AttendanceStatus, 
    note?: string
  ): Promise<OccurrenceParticipant> {
    const all = await this.repo.getParticipants();
    const target = all.find(p => p.id === participantId);
    if (!target) {
      throw new Error('Participant record not found.');
    }

    const updated: OccurrenceParticipant = {
      ...target,
      attendanceStatus: status,
      attendanceMethod: 'MANUAL',
      manualNote: note?.trim() || undefined,
      updatedAt: new Date().toISOString()
    };

    return this.repo.saveParticipant(updated);
  }
}

export const eventService = new EventService();
