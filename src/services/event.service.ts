import type {
  Event,
  EventOccurrence,
  OccurrenceParticipant,
  CreateEventDto,
  CreateOccurrenceDto,
  UpdateOccurrenceDto,
  AttendanceStatus,
  AttendanceCheckpoint,
} from '@/types/event';
import type { AttendanceStats } from '@/types/attendance';
import { localEventRepository, type IEventRepository } from '@/storage/event-storage.service';
import { EventsRepository } from '@/database/repositories/events.repository';
import { studentService } from '@/services/student.service';
import { OperationPolicyService } from './operation-policy.service';
import { DataModeService } from './data-mode.service';
import { supabase } from '@/integrations/supabase/client';
import { logDataSource } from '@/utilities/data-source-logger';
import { generateUuid } from '@/utilities/uuid';
import { getDatabase } from '@/database/database';

export interface SupabaseEventPayload {
  id: string;
  semester_id: string;
  title: string;
  event_type: string;
  audience_type: string;
  audience_json: any;
  attendance_required: number;
  status: string;
  created_at: string;
  updated_at: string;
  category_id?: string | null;
}

export interface SupabaseOccurrencePayload {
  id: string;
  event_id: string;
  title: string;
  occurs_on: string;
  starts_at: string;
  ends_at: string;
  grace_minutes: number;
  status: string;
  updated_at: string;
  opened_at?: string | null;
  closed_at?: string | null;
}

export function toSupabaseEventInsertPayload(
  event: Pick<Event, 'id' | 'title' | 'type' | 'audience' | 'attendanceRequired' | 'status' | 'createdAt' | 'updatedAt' | 'categoryId'>,
  semesterId: string
): SupabaseEventPayload {
  const rawId = event.id.startsWith('evt_') ? event.id.replace(/^evt_/, '') : event.id;
  const payload: SupabaseEventPayload = {
    id: rawId,
    semester_id: semesterId,
    title: event.title,
    event_type: event.type,
    audience_type: event.audience?.type || 'ALL',
    audience_json: event.audience,
    attendance_required: event.attendanceRequired ? 1 : 0,
    status: event.status || 'ACTIVE',
    created_at: event.createdAt,
    updated_at: event.updatedAt,
  };
  if (event.categoryId) {
    payload.category_id = event.categoryId;
  }
  return payload;
}

export function toSupabaseOccurrenceInsertPayload(
  occurrence: Pick<EventOccurrence, 'id' | 'eventId' | 'title' | 'date' | 'startTime' | 'endTime' | 'gracePeriodMinutes' | 'status' | 'createdAt' | 'openedAt' | 'closedAt'>
): SupabaseOccurrencePayload {
  const rawId = occurrence.id.startsWith('occ_') ? occurrence.id.replace(/^occ_/, '') : occurrence.id;
  const rawEventId = occurrence.eventId.startsWith('evt_') ? occurrence.eventId.replace(/^evt_/, '') : occurrence.eventId;
  return {
    id: rawId,
    event_id: rawEventId,
    title: occurrence.title,
    occurs_on: occurrence.date,
    starts_at: occurrence.startTime,
    ends_at: occurrence.endTime,
    grace_minutes: occurrence.gracePeriodMinutes ?? 15,
    status: occurrence.status || 'SCHEDULED',
    updated_at: occurrence.createdAt || new Date().toISOString(),
    opened_at: occurrence.openedAt || null,
    closed_at: occurrence.closedAt || null,
  };
}

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export class EventService {
  constructor(private repo: IEventRepository = localEventRepository) { }

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
      const rawId = id.startsWith('evt_') ? id.replace(/^evt_/, '') : id;
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', rawId)
        .maybeSingle();
      if (error) throw new Error(`Failed to query event from Supabase: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        title: data.title,
        description: data.description || '',
        type: data.event_type,
        categoryId: data.category_id,
        semesterId: data.semester_id,
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
    const eventId = generateUuid();
    const newEvent: Event = {
      id: eventId,
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

      const payload = toSupabaseEventInsertPayload(newEvent, semesterId);
      const { error } = await supabase.from('events').insert(payload);
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
      const rawId = id.startsWith('evt_') ? id.replace(/^evt_/, '') : id;
      const updatePayload: Record<string, any> = {
        title: updated.title,
        event_type: updated.type,
        audience_type: updated.audience?.type || 'ALL',
        audience_json: updated.audience,
        attendance_required: updated.attendanceRequired ? 1 : 0,
        status: updated.status,
        updated_at: updated.updatedAt,
      };
      if (updated.categoryId) {
        updatePayload.category_id = updated.categoryId;
      }

      const { error } = await supabase
        .from('events')
        .update(updatePayload)
        .eq('id', rawId);
      if (error) throw new Error(`Failed to update event on Supabase: ${error.message}`);
      return updated;
    }

    return this.repo.saveEvent(updated);
  }

  async deleteEvent(id: string): Promise<void> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');
    if (DataModeService.isDirectSupabase()) {
      const rawId = id.startsWith('evt_') ? id.replace(/^evt_/, '') : id;
      const { error } = await supabase.from('events').delete().eq('id', rawId);
      if (error) throw new Error(`Failed to delete event from Supabase: ${error.message}`);
      return;
    }
    return this.repo.deleteEvent(id);
  }

  public parseCheckpoints(rowOrJson: any): AttendanceCheckpoint[] {
    let raw = rowOrJson;
    if (rowOrJson && typeof rowOrJson === 'object' && 'checkpoints_json' in rowOrJson) {
      raw = rowOrJson.checkpoints_json;
    }
    let checkpoints: AttendanceCheckpoint[] = [];
    if (raw) {
      try {
        checkpoints = typeof raw === 'string'
          ? JSON.parse(raw)
          : raw;
      } catch {
        checkpoints = [];
      }
    }
    if (!checkpoints || checkpoints.length === 0) {
      const occurrenceId = rowOrJson?.id || (typeof rowOrJson === 'string' ? rowOrJson : 'default_in');
      checkpoints = this.getDefaultCheckpoints(occurrenceId, rowOrJson?.starts_at || '08:00', rowOrJson?.ends_at || '12:00', rowOrJson?.grace_minutes || 15);
    }
    return checkpoints.map((c, idx) => {
      const startTime = c.startTime || c.opensAt || rowOrJson?.starts_at || '08:00';
      const endTime = c.endTime || c.closesAt || rowOrJson?.ends_at || '12:00';
      return {
        ...c,
        startTime,
        endTime,
        opensAt: c.opensAt,
        closesAt: c.closesAt,
        orderIndex: c.orderIndex ?? idx,
      };
    });
  }

  public getDefaultCheckpoints(_occurrenceId?: string, startTime = '08:00', endTime = '12:00', graceMinutes = 15): AttendanceCheckpoint[] {
    return [
      {
        id: 'default_in',
        label: 'General Check-In',
        type: 'IN',
        startTime: startTime || '08:00',
        endTime: endTime || '12:00',
        graceMinutes,
        orderIndex: 0,
      },
    ];
  }

  async updateOccurrenceCheckpoints(
    occurrenceId: string,
    checkpoints: AttendanceCheckpoint[],
    activeCheckpointId?: string | null
  ): Promise<void> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');
    const rawId = occurrenceId.startsWith('occ_') ? occurrenceId.replace(/^occ_/, '') : occurrenceId;
    const normalizedCheckpoints = checkpoints.map((c, idx) => {
      const opensAt = c.opensAt || c.startTime || '08:00';
      const closesAt = c.closesAt || c.endTime || '12:00';
      return {
        ...c,
        startTime: opensAt,
        endTime: closesAt,
        opensAt,
        closesAt,
        orderIndex: c.orderIndex ?? idx,
      };
    });
    const activeId = activeCheckpointId ?? normalizedCheckpoints[0]?.id ?? null;

    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase
        .from('event_occurrences')
        .update({
          checkpoints_json: normalizedCheckpoints,
          active_checkpoint_id: activeId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rawId);
      if (error) throw new Error(`Failed to update checkpoints on Supabase: ${error.message}`);
      return;
    }

    const db = await getDatabase();
    await db.execute(
      'UPDATE event_occurrences SET checkpoints_json = ?, active_checkpoint_id = ?, updated_at = ? WHERE id = ? OR id = ?',
      [JSON.stringify(normalizedCheckpoints), activeId, new Date().toISOString(), occurrenceId, rawId]
    );
  }

  async setActiveCheckpoint(occurrenceId: string, checkpointId: string): Promise<void> {
    const rawId = occurrenceId.startsWith('occ_') ? occurrenceId.replace(/^occ_/, '') : occurrenceId;
    if (DataModeService.isDirectSupabase()) {
      const { error } = await supabase
        .from('event_occurrences')
        .update({ active_checkpoint_id: checkpointId, updated_at: new Date().toISOString() })
        .eq('id', rawId);
      if (error) console.warn('[EventService] setActiveCheckpoint warning:', error);
      return;
    }
    const db = await getDatabase();
    await db.execute('UPDATE event_occurrences SET active_checkpoint_id = ?, updated_at = ? WHERE id = ? OR id = ?', [
      checkpointId,
      new Date().toISOString(),
      occurrenceId,
      rawId,
    ]);
  }

  async getOccurrences(eventId?: string): Promise<EventOccurrence[]> {
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('event_occurrences').select('*').order('occurs_on', { ascending: false });
      if (eventId) {
        const rawEventId = eventId.startsWith('evt_') ? eventId.replace(/^evt_/, '') : eventId;
        query = query.eq('event_id', rawEventId);
      }
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
        checkpoints: this.parseCheckpoints(row),
        activeCheckpointId: row.active_checkpoint_id || null,
        openedAt: row.opened_at,
        closedAt: row.closed_at,
        createdAt: row.updated_at || new Date().toISOString(),
      }));
    }
    return this.repo.getOccurrences(eventId);
  }

  async getOccurrence(id: string): Promise<EventOccurrence | null> {
    if (DataModeService.isDirectSupabase()) {
      const rawId = id.startsWith('occ_') ? id.replace(/^occ_/, '') : id;
      const { data, error } = await supabase.from('event_occurrences').select('*').eq('id', rawId).maybeSingle();
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
        checkpoints: this.parseCheckpoints(data),
        activeCheckpointId: data.active_checkpoint_id || null,
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
    const isDirect = DataModeService.isDirectSupabase();
    // 1. Generate raw UUIDs for event_occurrences.id in Direct Supabase Mode
    // 2. Preserve offline-first SQLite ID behavior
    const occurrenceId = isDirect ? generateUuid() : generateId('occ');
    // Ensure event_id references the clean raw UUID of the parent event
    const rawEventId = (isDirect && dto.eventId.startsWith('evt_'))
      ? dto.eventId.replace(/^evt_/, '')
      : dto.eventId;

    const occurrence: EventOccurrence = {
      id: occurrenceId,
      eventId: rawEventId,
      title: dto.title.trim(),
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      gracePeriodMinutes: dto.gracePeriodMinutes ?? 15,
      status: 'SCHEDULED',
      createdAt: now
    };

    if (isDirect) {
      const payload = toSupabaseOccurrenceInsertPayload(occurrence);
      const { error } = await supabase.from('event_occurrences').insert(payload);
      if (error) throw new Error(`Failed to create occurrence on Supabase: ${error.message}`);
      return occurrence;
    }

    return this.repo.saveOccurrence(occurrence);
  }

  async updateOccurrence(dto: UpdateOccurrenceDto): Promise<EventOccurrence> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');

    const occ = await this.getOccurrence(dto.occurrenceId);
    if (!occ) {
      throw new Error('Attendance session does not exist.');
    }

    const now = new Date().toISOString();
    const rawId = dto.occurrenceId.startsWith('occ_') ? dto.occurrenceId.replace(/^occ_/, '') : dto.occurrenceId;
    const normalizedCheckpoints = dto.checkpoints ? dto.checkpoints.map((c, idx) => {
      const opensAt = c.opensAt || c.startTime || dto.startTime || occ.startTime || '08:00';
      const closesAt = c.closesAt || c.endTime || dto.endTime || occ.endTime || '12:00';
      return {
        ...c,
        startTime: opensAt,
        endTime: closesAt,
        opensAt,
        closesAt,
        orderIndex: c.orderIndex ?? idx,
      };
    }) : undefined;

    if (DataModeService.isDirectSupabase()) {
      const remoteUpdates: Record<string, any> = {
        updated_at: now,
      };
      if (dto.title !== undefined) remoteUpdates.title = dto.title.trim();
      if (dto.date !== undefined) remoteUpdates.occurs_on = dto.date;
      if (dto.startTime !== undefined) remoteUpdates.starts_at = dto.startTime;
      if (dto.endTime !== undefined) remoteUpdates.ends_at = dto.endTime;
      if (dto.gracePeriodMinutes !== undefined) remoteUpdates.grace_minutes = dto.gracePeriodMinutes;
      if (normalizedCheckpoints !== undefined) {
        remoteUpdates.checkpoints_json = normalizedCheckpoints;
        remoteUpdates.active_checkpoint_id = dto.activeCheckpointId ?? normalizedCheckpoints[0]?.id ?? null;
      }

      const { data, error } = await supabase
        .from('event_occurrences')
        .update(remoteUpdates)
        .eq('id', rawId)
        .select()
        .single();

      if (error) throw new Error(`Failed to update attendance session on Supabase: ${error.message}`);

      return {
        id: data.id,
        eventId: data.event_id,
        title: data.title,
        date: data.occurs_on,
        startTime: data.starts_at,
        endTime: data.ends_at,
        gracePeriodMinutes: data.grace_minutes || 15,
        status: data.status,
        checkpoints: this.parseCheckpoints(data),
        activeCheckpointId: data.active_checkpoint_id || null,
        openedAt: data.opened_at,
        closedAt: data.closed_at,
        createdAt: data.created_at || now,
      };
    }

    await EventsRepository.updateOccurrence({
      id: dto.occurrenceId,
      title: dto.title !== undefined ? dto.title.trim() : undefined,
      occurs_on: dto.date,
      starts_at: dto.startTime,
      ends_at: dto.endTime,
      grace_minutes: dto.gracePeriodMinutes,
      checkpoints_json: normalizedCheckpoints ? JSON.stringify(normalizedCheckpoints) : undefined,
      active_checkpoint_id: dto.activeCheckpointId,
      updated_at: now,
    });

    const updated = await this.repo.getOccurrenceById(dto.occurrenceId);
    const merged: EventOccurrence = {
      ...(updated || occ),
      title: dto.title !== undefined ? dto.title.trim() : occ.title,
      date: dto.date !== undefined ? dto.date : occ.date,
      startTime: dto.startTime !== undefined ? dto.startTime : occ.startTime,
      endTime: dto.endTime !== undefined ? dto.endTime : occ.endTime,
      gracePeriodMinutes: dto.gracePeriodMinutes !== undefined ? dto.gracePeriodMinutes : occ.gracePeriodMinutes,
      checkpoints: normalizedCheckpoints !== undefined ? normalizedCheckpoints : occ.checkpoints,
      activeCheckpointId: dto.activeCheckpointId !== undefined ? dto.activeCheckpointId : occ.activeCheckpointId,
    };
    return this.repo.saveOccurrence(merged);
  }

  async deleteOccurrence(id: string): Promise<void> {
    await OperationPolicyService.assertPermitted('EVENTS_AND_OCCURRENCES_MUTATIONS');

    if (DataModeService.isDirectSupabase()) {
      const rawId = id.startsWith('occ_') ? id.replace(/^occ_/, '') : id;
      const { error } = await supabase.from('event_occurrences').delete().eq('id', rawId);
      if (error) throw new Error(`Failed to delete attendance session from Supabase: ${error.message}`);
      return;
    }

    await EventsRepository.deleteOccurrence(id);
    await this.repo.deleteOccurrence(id);
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
      const rawId = occurrenceId.startsWith('occ_') ? occurrenceId.replace(/^occ_/, '') : occurrenceId;
      await supabase.from('event_occurrences').update({ status: 'OPEN', opened_at: occurrence.openedAt }).eq('id', rawId);
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
      const rawId = occurrenceId.startsWith('occ_') ? occurrenceId.replace(/^occ_/, '') : occurrenceId;
      await supabase.from('event_occurrences').update({ status: 'CLOSED', closed_at: now }).eq('id', rawId);
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
        checkpointId: row.checkpoint_id || 'default_in',
        attendanceStatus: (row.status as AttendanceStatus) || 'PENDING',
        attendanceTime: row.checked_in_at || undefined,
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
