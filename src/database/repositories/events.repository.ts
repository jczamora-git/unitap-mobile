import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { EventRecord, EventOccurrenceRecord } from '../../types/database';

export class EventsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async createEvent(event: EventRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO events (
        id, semester_id, title, description, event_type, audience_type, audience_json,
        attendance_required, status, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.semester_id,
        event.title,
        event.description || null,
        event.event_type,
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
    const db = await this.getDb(adapter);
    return db.query<EventRecord>(
      'SELECT * FROM events WHERE semester_id = ? ORDER BY created_at DESC',
      [semesterId]
    );
  }

  public static async getEventById(id: string, adapter?: DatabaseAdapter): Promise<EventRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<EventRecord>('SELECT * FROM events WHERE id = ?', [id]);
  }

  public static async createOccurrence(occurrence: EventOccurrenceRecord, adapter?: DatabaseAdapter): Promise<void> {
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
    const db = await this.getDb(adapter);
    return db.query<EventOccurrenceRecord>(
      'SELECT * FROM event_occurrences WHERE event_id = ? ORDER BY occurs_on ASC, starts_at ASC',
      [eventId]
    );
  }

  public static async getOccurrenceById(id: string, adapter?: DatabaseAdapter): Promise<EventOccurrenceRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<EventOccurrenceRecord>(
      'SELECT * FROM event_occurrences WHERE id = ?',
      [id]
    );
  }

  public static async getActiveOccurrences(adapter?: DatabaseAdapter): Promise<(EventOccurrenceRecord & { event_title: string; semester_id: string })[]> {
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

