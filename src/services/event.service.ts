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
import { OperationPolicyService } from './operation-policy.service';
import { DataModeService } from './data-mode.service';
import { supabase } from '@/integrations/supabase/client';
import { logDataSource } from '@/utilities/data-source-logger';

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export class EventService {
  constructor(private repo: IEventRepository = localEventRepository) {}

  async getEvents(): Promise<Event[]> {
    if (DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Failed to query events from Supabase: ${error.message}`);
      return (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        description: row.description || '',
        type: row.event_type,
        audience: row.audience_json || { type: row.audience_type || 'ALL_BSIT' },
        attendanceRequired: Boolean(row.attendance_required),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }
    return this.repo.getEvents();
  }

  async getEvent(id: string): Promise<Event | null> {
    if (DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(`Failed to query event from Supabase: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        title: data.title,
        description: data.description || '',
        type: data.event_type,
        audience: data.audience_json || { type: data.audience_type || 'ALL_BSIT' },
        attendanceRequired: Boolean(data.attendance_required),
        status: data.status,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }
    return this.repo.getEventById(id);
  }

  async createEvent(dto: CreateEventDto): Promise<Event> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');

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

    if (DataModeService.isDirectSupabase()) {
      const { data: semData } = await supabase.from('semesters').select('id').eq('status', 'ACTIVE').limit(1).maybeSingle();
      const semesterId = semData?.id || 'sem_2026_2027_1';

      const { error } = await supabase.from('events').insert({
        id: newEvent.id,
        semester_id: semesterId,
        title: newEvent.title,
        description: newEvent.description || null,
        event_type: newEvent.type,
        audience_type: newEvent.audience?.type || 'ALL',
        audience_json: newEvent.audience,
        attendance_required: newEvent.attendanceRequired ? 1 : 0,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      });
      if (error) throw new Error(`Failed to create event on Supabase: ${error.message}`);
      return newEvent;
    }

    return this.repo.saveEvent(newEvent);
  }

  async updateEvent(id: string, updates: Partial<Event>): Promise<Event> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');

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

    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase
        .from('events')
        .update({
          title: updated.title,
          description: updated.description || null,
          event_type: updated.type,
          audience_type: updated.audience?.type || 'ALL',
          audience_json: updated.audience,
          attendance_required: updated.attendanceRequired ? 1 : 0,
          status: updated.status,
          updated_at: updated.updatedAt,
        })
        .eq('id', id);
      if (error) throw new Error(`Failed to update event on Supabase: ${error.message}`);
      return updated;
    }

    return this.repo.saveEvent(updated);
  }

  async deleteEvent(id: string): Promise<void> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');
    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw new Error(`Failed to delete event from Supabase: ${error.message}`);
      return;
    }
    return this.repo.deleteEvent(id);
  }

  async getOccurrences(eventId?: string): Promise<EventOccurrence[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('event_occurrences').select('*').order('occurs_on', { ascending: false });
      if (eventId) query = query.eq('event_id', eventId);
      const { data, error } = await query;
      if (error) throw new Error(`Failed to query occurrences from Supabase: ${error.message}`);
      return (data || []).map((row: any) => ({
        id: row.id,
        eventId: row.event_id,
        title: row.title,
        date: row.occurs_on,
        startTime: row.starts_at,
        endTime: row.ends_at,
        gracePeriodMinutes: row.grace_minutes || 15,
        status: row.status,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        createdAt: row.updated_at || new Date().toISOString(),
      }));
    }
    return this.repo.getOccurrences(eventId);
  }

  async getOccurrence(id: string): Promise<EventOccurrence | null> {
    if (DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase.from('event_occurrences').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`Failed to query occurrence from Supabase: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        eventId: data.event_id,
        title: data.title,
        date: data.occurs_on,
        startTime: data.starts_at,
        endTime: data.ends_at,
        gracePeriodMinutes: data.grace_minutes || 15,
        status: data.status,
        openedAt: data.opened_at,
        closedAt: data.closed_at,
        createdAt: data.updated_at || new Date().toISOString(),
      };
    }
    return this.repo.getOccurrenceById(id);
  }

  async createOccurrence(dto: CreateOccurrenceDto): Promise<EventOccurrence> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');

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

    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('event_occurrences').insert({
        id: occurrence.id,
        event_id: occurrence.eventId,
        title: occurrence.title,
        occurs_on: occurrence.date,
        starts_at: occurrence.startTime,
        ends_at: occurrence.endTime,
        grace_minutes: occurrence.gracePeriodMinutes,
        status: 'SCHEDULED',
        updated_at: now,
      });
      if (error) throw new Error(`Failed to create occurrence on Supabase: ${error.message}`);
      return occurrence;
    }

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
    if (DataModeService.isDirectSupabase()) {
      await supabase.from('event_occurrences').update({ status: 'OPEN', opened_at: occurrence.openedAt }).eq('id', occurrenceId);
      return occurrence;
    }
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
    if (DataModeService.isDirectSupabase()) {
      await supabase.from('event_occurrences').update({ status: 'CLOSED', closed_at: now }).eq('id', occurrenceId);
      return occurrence;
    }

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
    const eligibleStudents = allStudents.filter((s) => {
      // Must be active student
      if (s.status && s.status !== 'ACTIVE') return false;

      if (audience.type === 'ALL_BSIT') {
        return (s.course || 'BSIT').toUpperCase() === 'BSIT';
      }
      if (audience.type === 'YEAR_LEVEL' && audience.yearLevels && audience.yearLevels.length > 0) {
        return audience.yearLevels.includes(s.yearLevel);
      }
      if (audience.type === 'SECTION' && audience.sections && audience.sections.length > 0) {
        return audience.sections.some((sec) => sec.toLowerCase() === (s.section || '').toLowerCase());
      }
      return true;
    });

    const now = new Date().toISOString();
    const participants: OccurrenceParticipant[] = eligibleStudents.map((s) => ({
      id: generateId('part'),
      occurrenceId,
      eventId: event.id,
      studentId: s.id,
      attendanceStatus: 'PENDING',
      updatedAt: now,
    }));

    if (DataModeService.isDirectSupabase()) {
      return participants;
    }

    await this.repo.saveParticipants(participants);
    return participants;
  }

  async getOccurrenceStats(occurrenceId: string): Promise<AttendanceStats> {
    const participants = await this.getParticipants(occurrenceId);
    let presentCount = 0;
    let lateCount = 0;
    let pendingCount = 0;
    let absentCount = 0;
    let excusedCount = 0;

    participants.forEach((p) => {
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
      excusedCount,
    };
  }

  async getParticipants(occurrenceId?: string): Promise<OccurrenceParticipant[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('attendance_records').select('*');
      if (occurrenceId) {
        query = query.eq('occurrence_id', occurrenceId);
      }
      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to query attendance participants from Supabase: ${error.message}`);
      }
      const result = (data || []).map((row: any) => ({
        id: row.id,
        occurrenceId: row.occurrence_id,
        eventId: row.event_id || '',
        studentId: row.student_id,
        attendanceStatus: (row.status as AttendanceStatus) || 'PENDING',
        checkInTime: row.checked_in_at || undefined,
        attendanceMethod: row.method || 'NFC',
        manualNote: row.notes || undefined,
        updatedAt: row.updated_at,
      }));
      logDataSource({
        page: 'EventService',
        source: 'Supabase',
        operation: 'SELECT attendance_records (participants)',
        result: result.length,
      });
      return result;
    }
    return this.repo.getParticipants(occurrenceId);
  }

  async updateParticipantStatus(
    participantId: string, 
    status: AttendanceStatus, 
    note?: string
  ): Promise<OccurrenceParticipant> {
    const all = await this.getParticipants();
    const target = all.find((p) => p.id === participantId);
    if (!target) {
      throw new Error('Participant record not found.');
    }

    const updated: OccurrenceParticipant = {
      ...target,
      attendanceStatus: status,
      attendanceMethod: 'MANUAL',
      manualNote: note?.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };

    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase
        .from('attendance_records')
        .update({
          status,
          method: 'MANUAL',
          notes: note?.trim() || null,
          updated_at: updated.updatedAt,
        })
        .eq('id', participantId);
      if (error) throw new Error(`Failed to update participant on Supabase: ${error.message}`);
      return updated;
    }

    return this.repo.saveParticipant(updated);
  }
}

export const eventService = new EventService();
