import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { EventRecord, EventOccurrenceRecord } from '../../types/database';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';

export class EventsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async createEvent(event: EventRecord, adapter?: DatabaseAdapter): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('events').insert({
        id: event.id,
        semester_id: event.semester_id,
        title: event.title,
        description: event.description || null,
        event_type: event.event_type,
        category_id: event.category_id || null,
        audience_type: event.audience_type,
        audience_json: event.audience_json,
        attendance_required: event.attendance_required,
        status: event.status,
        created_by_user_id: event.created_by_user_id || null,
        created_at: event.created_at,
        updated_at: event.updated_at,
      });
      if (error) throw new Error(`Failed to insert event into Supabase: ${error.message}`);
      return;
    }

    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO events (
        id, semester_id, title, description, event_type, category_id, audience_type, audience_json,
        attendance_required, status, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.semester_id,
        event.title,
        event.description || null,
        event.event_type,
        event.category_id || null,
        event.audience_type,
        event.audience_json,
        event.attendance_required,
        event.status,
        event.created_by_user_id || null,
        event.created_at,
        event.updated_at,
      ]
    );
  }

  public static async getEventsBySemester(semesterId: string, adapter?: DatabaseAdapter): Promise<EventRecord[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('semester_id', semesterId)
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Failed to query events from Supabase: ${error.message}`);
      return (data || []) as EventRecord[];
    }

    const db = await this.getDb(adapter);
    return db.query<EventRecord>(
      'SELECT * FROM events WHERE semester_id = ? ORDER BY created_at DESC',
      [semesterId]
    );
  }

  public static async getEventById(id: string, adapter?: DatabaseAdapter): Promise<EventRecord | null> {
    if (!id) return null;
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return data as EventRecord;
    }

    const db = await this.getDb(adapter);
    return db.queryOne<EventRecord>('SELECT * FROM events WHERE id = ?', [id]);
  }

  public static async createOccurrence(occurrence: EventOccurrenceRecord, adapter?: DatabaseAdapter): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('event_occurrences').insert({
        id: occurrence.id,
        event_id: occurrence.event_id,
        title: occurrence.title,
        occurs_on: occurrence.occurs_on,
        starts_at: occurrence.starts_at,
        ends_at: occurrence.ends_at,
        grace_minutes: occurrence.grace_minutes,
        status: occurrence.status,
        opened_at: occurrence.opened_at || null,
        closed_at: occurrence.closed_at || null,
        updated_at: occurrence.updated_at,
      });
      if (error) throw new Error(`Failed to insert occurrence into Supabase: ${error.message}`);
      return;
    }

    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO event_occurrences (
        id, event_id, title, occurs_on, starts_at, ends_at, grace_minutes,
        status, opened_at, closed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        occurrence.id,
        occurrence.event_id,
        occurrence.title,
        occurrence.occurs_on,
        occurrence.starts_at,
        occurrence.ends_at,
        occurrence.grace_minutes,
        occurrence.status,
        occurrence.opened_at || null,
        occurrence.closed_at || null,
        occurrence.updated_at,
      ]
    );
  }

  public static async updateOccurrence(
    occurrence: Partial<EventOccurrenceRecord> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const remoteUpdates: Record<string, unknown> = {
        updated_at: occurrence.updated_at || new Date().toISOString(),
      };
      if (occurrence.status !== undefined) remoteUpdates.status = occurrence.status;
      if (occurrence.opened_at !== undefined) remoteUpdates.opened_at = occurrence.opened_at;
      if (occurrence.closed_at !== undefined) remoteUpdates.closed_at = occurrence.closed_at;

      const { error } = await supabase.from('event_occurrences').update(remoteUpdates).eq('id', occurrence.id);
      if (error) throw new Error(`Failed to update occurrence on Supabase: ${error.message}`);
      return;
    }

    const db = await this.getDb(adapter);
    const updates: string[] = [];
    const params: unknown[] = [];

    if (occurrence.status !== undefined) {
      updates.push('status = ?');
      params.push(occurrence.status);
    }
    if (occurrence.opened_at !== undefined) {
      updates.push('opened_at = ?');
      params.push(occurrence.opened_at);
    }
    if (occurrence.closed_at !== undefined) {
      updates.push('closed_at = ?');
      params.push(occurrence.closed_at);
    }
    updates.push('updated_at = ?');
    params.push(occurrence.updated_at || new Date().toISOString());

    params.push(occurrence.id);
    await db.execute(
      `UPDATE event_occurrences SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }

  public static async getOccurrencesByEventId(eventId: string, adapter?: DatabaseAdapter): Promise<EventOccurrenceRecord[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('event_occurrences')
        .select('*')
        .eq('event_id', eventId)
        .order('occurs_on', { ascending: true });
      if (error) throw new Error(`Failed to query occurrences from Supabase: ${error.message}`);
      return (data || []) as EventOccurrenceRecord[];
    }

    const db = await this.getDb(adapter);
    return db.query<EventOccurrenceRecord>(
      'SELECT * FROM event_occurrences WHERE event_id = ? ORDER BY occurs_on ASC, starts_at ASC',
      [eventId]
    );
  }

  public static async getOccurrenceById(id: string, adapter?: DatabaseAdapter): Promise<EventOccurrenceRecord | null> {
    if (!id) return null;
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('event_occurrences')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return data as EventOccurrenceRecord;
    }

    const db = await this.getDb(adapter);
    return db.queryOne<EventOccurrenceRecord>(
      'SELECT * FROM event_occurrences WHERE id = ?',
      [id]
    );
  }

  public static async getActiveOccurrences(adapter?: DatabaseAdapter): Promise<(EventOccurrenceRecord & { event_title: string; semester_id: string })[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data: occs, error: occErr } = await supabase
        .from('event_occurrences')
        .select('*')
        .eq('status', 'OPEN')
        .order('occurs_on', { ascending: false });
      if (occErr) throw new Error(`Failed to query active occurrences from Supabase: ${occErr.message}`);

      const eventIds = Array.from(new Set((occs || []).map((o: any) => o.event_id).filter(Boolean)));
      const eventMap = new Map<string, any>();
      if (eventIds.length > 0) {
        const { data: evData } = await supabase.from('events').select('id, title, semester_id').in('id', eventIds);
        for (const ev of evData || []) eventMap.set(ev.id, ev);
      }

      return (occs || []).map((o: any) => {
        const ev = eventMap.get(o.event_id);
        return {
          ...o,
          event_title: ev?.title || '',
          semester_id: ev?.semester_id || '',
        };
      });
    }

    const db = await this.getDb(adapter);
    return db.query<EventOccurrenceRecord & { event_title: string; semester_id: string }>(
      `SELECT o.*, e.title as event_title, e.semester_id
       FROM event_occurrences o
       JOIN events e ON e.id = o.event_id
       WHERE o.status = 'OPEN'
       ORDER BY o.occurs_on DESC`
    );
  }

  public static async addParticipants(
    participants: {
      id: string;
      occurrence_id: string;
      student_id: string;
      enrollment_id: string;
      expected: number;
      added_at: string;
    }[],
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      return;
    }

    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      for (const p of participants) {
        await tx.execute(
          `INSERT OR IGNORE INTO event_participants (id, occurrence_id, student_id, enrollment_id, expected, added_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [p.id, p.occurrence_id, p.student_id, p.enrollment_id, p.expected, p.added_at]
        );
      }
    });
  }
}

