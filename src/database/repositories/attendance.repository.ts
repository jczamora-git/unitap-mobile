import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { AttendanceRecord, AttendanceAttemptRecord } from '../../types/database';

export interface AttendanceRecordWithStudent extends AttendanceRecord {
  school_id: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  year_level?: number;
  section?: string;
  photo_local_uri?: string | null;
}

export class AttendanceRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async logAttempt(
    attempt: AttendanceAttemptRecord,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO attendance_attempts (
        id, occurrence_id, student_id, card_id, uid_normalized,
        actor_user_id, device_id, result, photo_displayed, notes, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        attempt.id,
        attempt.occurrence_id,
        attempt.student_id || null,
        attempt.card_id || null,
        attempt.uid_normalized,
        attempt.actor_user_id || null,
        attempt.device_id || null,
        attempt.result,
        attempt.photo_displayed,
        attempt.notes || null,
        attempt.occurred_at,
      ]
    );
  }

  public static async recordAttendance(
    record: AttendanceRecord,
    actorUserId: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      // 1. Insert or update attendance record
      await tx.execute(
        `INSERT INTO attendance_records (
          id, occurrence_id, student_id, status, checked_in_at, method,
          identity_verified_by_user_id, photo_checked, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(occurrence_id, student_id) DO UPDATE SET
          status = excluded.status,
          checked_in_at = excluded.checked_in_at,
          method = excluded.method,
          identity_verified_by_user_id = excluded.identity_verified_by_user_id,
          photo_checked = excluded.photo_checked,
          updated_at = excluded.updated_at`,
        [
          record.id,
          record.occurrence_id,
          record.student_id,
          record.status,
          record.checked_in_at || new Date().toISOString(),
          record.method || 'NFC',
          record.identity_verified_by_user_id || actorUserId,
          record.photo_checked,
          record.updated_at,
        ]
      );

      // 2. Insert audit log
      const auditId = 'aud_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO attendance_audit (
          id, attendance_id, action, old_status, new_status, actor_user_id, reason, created_at
        ) VALUES (?, ?, 'CHECK_IN', NULL, ?, ?, 'Officer identity confirmation', ?)`,
        [auditId, record.id, record.status, actorUserId, record.updated_at]
      );

      // 3. Transactional Outbox write
      const outboxId = 'op_att_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
         VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
        [record.updated_at]
      );
      await tx.execute(
        `INSERT INTO sync_outbox (
          id, device_id, entity_type, entity_id, operation, payload_json,
          schema_version, created_at, retry_count
        ) VALUES (?, 'dev_default', 'ATTENDANCE', ?, 'CREATE', ?, 1, ?, 0)`,
        [
          outboxId,
          record.id,
          JSON.stringify({
            id: record.id,
            occurrence_id: record.occurrence_id,
            student_id: record.student_id,
            status: record.status,
            checked_in_at: record.checked_in_at,
            identity_verified_by_user_id: record.identity_verified_by_user_id,
            method: record.method,
            photo_checked: record.photo_checked,
            updated_at: record.updated_at,
          }),
          record.updated_at,
        ]
      );
    });
  }

  public static async voidAttendance(
    attendanceId: string,
    reason: string,
    actorUserId: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('A reason is mandatory to void attendance.');
    }

    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const existing = await tx.queryOne<AttendanceRecord>(
        'SELECT * FROM attendance_records WHERE id = ?',
        [attendanceId]
      );
      if (!existing) {
        throw new Error('Attendance record not found.');
      }
      if (existing.status === 'VOID') {
        throw new Error('Attendance record is already voided.');
      }

      const now = new Date().toISOString();
      await tx.execute(
        `UPDATE attendance_records
         SET status = 'VOID', voided_at = ?, voided_by_user_id = ?, void_reason = ?, updated_at = ?
         WHERE id = ?`,
        [now, actorUserId, reason.trim(), now, attendanceId]
      );

      const auditId = 'aud_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO attendance_audit (
          id, attendance_id, action, old_status, new_status, actor_user_id, reason, created_at
        ) VALUES (?, ?, 'VOID', ?, 'VOID', ?, ?, ?)`,
        [auditId, attendanceId, existing.status, actorUserId, reason.trim(), now]
      );
    });
  }

  public static async getRecord(
    occurrenceId: string,
    studentId: string,
    adapter?: DatabaseAdapter
  ): Promise<AttendanceRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<AttendanceRecord>(
      'SELECT * FROM attendance_records WHERE occurrence_id = ? AND student_id = ?',
      [occurrenceId, studentId]
    );
  }

  public static async getRecordsByOccurrence(
    occurrenceId: string,
    adapter?: DatabaseAdapter
  ): Promise<AttendanceRecordWithStudent[]> {
    const db = await this.getDb(adapter);
    return db.query<AttendanceRecordWithStudent>(
      `SELECT ar.*, s.school_id, s.first_name, s.middle_name, s.last_name, s.photo_local_uri,
              e.year_level, e.section
       FROM attendance_records ar
       JOIN students s ON s.id = ar.student_id
       LEFT JOIN event_occurrences eo ON eo.id = ar.occurrence_id
       LEFT JOIN events ev ON ev.id = eo.event_id
       LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.semester_id = ev.semester_id
       WHERE ar.occurrence_id = ?
       ORDER BY ar.checked_in_at DESC`,
      [occurrenceId]
    );
  }

  public static async getStudentAttendanceHistory(
    studentId: string,
    semesterId?: string,
    adapter?: DatabaseAdapter
  ): Promise<(AttendanceRecord & { event_title: string; occurrence_title: string; occurs_on: string })[]> {
    const db = await this.getDb(adapter);
    let sql = `
      SELECT ar.*, ev.title as event_title, eo.title as occurrence_title, eo.occurs_on
      FROM attendance_records ar
      JOIN event_occurrences eo ON eo.id = ar.occurrence_id
      JOIN events ev ON ev.id = eo.event_id
      WHERE ar.student_id = ?
    `;
    const params: unknown[] = [studentId];
    if (semesterId) {
      sql += ' AND ev.semester_id = ?';
      params.push(semesterId);
    }
    sql += ' ORDER BY eo.occurs_on DESC, ar.checked_in_at DESC';
    return db.query(sql, params);
  }
}
