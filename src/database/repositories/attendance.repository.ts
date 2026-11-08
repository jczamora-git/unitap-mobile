import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { AttendanceRecord, AttendanceAttemptRecord } from '../../types/database';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';

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
          id, occurrence_id, student_id, status, checked_in_at, client_scanned_at, method,
          identity_verified_by_user_id, photo_checked, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(occurrence_id, student_id) DO UPDATE SET
          status = excluded.status,
          checked_in_at = excluded.checked_in_at,
          client_scanned_at = excluded.client_scanned_at,
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
          record.client_scanned_at || null,
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
            client_scanned_at: record.client_scanned_at || record.checked_in_at,
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
    expectedVersion?: number,
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
      if (existing.status === 'VOID' || existing.status === 'REVOKED') {
        throw new Error('Attendance record is already revoked.');
      }
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new Error(
          `The record was modified concurrently (current version ${existing.version} vs expected ${expectedVersion}). Please refresh.`
        );
      }

      const now = new Date().toISOString();
      const newVersion = (existing.version || 1) + 1;
      await tx.execute(
        `UPDATE attendance_records
         SET status = 'VOID', voided_at = ?, voided_by_user_id = ?, void_reason = ?,
             revoked_at = ?, revoked_by_user_id = ?, revocation_reason = ?, version = ?, updated_at = ?
         WHERE id = ?`,
        [now, actorUserId, reason.trim(), now, actorUserId, reason.trim(), newVersion, now, attendanceId]
      );

      const auditId = 'aud_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO attendance_audit (
          id, attendance_id, occurrence_id, student_id, action, old_status, new_status, actor_user_id, reason, created_at, performed_by_user_id, performed_at
        ) VALUES (?, ?, ?, ?, 'VOID', ?, 'VOID', ?, ?, ?, ?, ?)`,
        [auditId, attendanceId, existing.occurrence_id, existing.student_id, existing.status, actorUserId, reason.trim(), now, actorUserId, now]
      );

      // Enqueue sync outbox VOID operation
      const outboxId = 'op_att_rev_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO sync_outbox (
          id, device_id, entity_type, entity_id, operation, payload_json,
          schema_version, created_at, retry_count
        ) VALUES (?, 'dev_default', 'ATTENDANCE', ?, 'VOID', ?, 1, ?, 0)`,
        [
          outboxId,
          attendanceId,
          JSON.stringify({
            id: attendanceId,
            status: 'REVOKED',
            revocation_reason: reason.trim(),
            revoked_at: now,
            revoked_by_user_id: actorUserId,
            version: newVersion,
            updated_at: now,
          }),
          now,
        ]
      );
    });
  }

  public static async recheckAttendance(
    attendanceId: string,
    reason: string,
    actorUserId: string,
    targetStatus: 'PRESENT' | 'LATE' = 'PRESENT',
    expectedVersion?: number,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('A reason is mandatory to approve an attendance recheck.');
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
      if (existing.status !== 'VOID' && existing.status !== 'REVOKED') {
        throw new Error('Attendance record is not in REVOKED state.');
      }
      if (expectedVersion !== undefined && existing.version !== expectedVersion) {
        throw new Error(
          `The record was modified concurrently (current version ${existing.version} vs expected ${expectedVersion}). Please refresh.`
        );
      }

      const now = new Date().toISOString();
      const newVersion = (existing.version || 1) + 1;
      await tx.execute(
        `UPDATE attendance_records
         SET status = ?, voided_at = NULL, voided_by_user_id = NULL, void_reason = NULL,
             revoked_at = NULL, revoked_by_user_id = NULL, revocation_reason = NULL,
             identity_verified_by_user_id = ?, version = ?, updated_at = ?
         WHERE id = ?`,
        [targetStatus, actorUserId, newVersion, now, attendanceId]
      );

      const auditId = 'aud_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO attendance_audit (
          id, attendance_id, occurrence_id, student_id, action, old_status, new_status, actor_user_id, reason, created_at, performed_by_user_id, performed_at
        ) VALUES (?, ?, ?, ?, 'REINSTATE', 'VOID', ?, ?, ?, ?, ?, ?)`,
        [auditId, attendanceId, existing.occurrence_id, existing.student_id, targetStatus, actorUserId, reason.trim(), now, actorUserId, now]
      );

      const outboxId = 'op_att_recheck_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO sync_outbox (
          id, device_id, entity_type, entity_id, operation, payload_json,
          schema_version, created_at, retry_count
        ) VALUES (?, 'dev_default', 'ATTENDANCE', ?, 'UPDATE', ?, 1, ?, 0)`,
        [
          outboxId,
          attendanceId,
          JSON.stringify({
            id: attendanceId,
            status: targetStatus,
            voided_at: null,
            void_reason: null,
            revoked_at: null,
            revocation_reason: null,
            identity_verified_by_user_id: actorUserId,
            version: newVersion,
            updated_at: now,
          }),
          now,
        ]
      );
    });
  }

  public static async getAuditTrail(
    attendanceId: string,
    adapter?: DatabaseAdapter
  ): Promise<Array<{
    id: string;
    action: string;
    old_status?: string | null;
    new_status: string;
    reason?: string | null;
    actor_user_id: string;
    created_at: string;
    performed_at?: string | null;
  }>> {
    const db = await this.getDb(adapter);
    return db.query(
      `SELECT * FROM attendance_audit WHERE attendance_id = ? ORDER BY coalesce(performed_at, created_at) DESC`,
      [attendanceId]
    );
  }

  public static async getRecord(
    occurrenceId: string,
    studentId: string,
    adapter?: DatabaseAdapter
  ): Promise<AttendanceRecord | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('occurrence_id', occurrenceId)
        .eq('student_id', studentId)
        .maybeSingle();
      if (error || !data) return null;
      return data as AttendanceRecord;
    }

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
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data: records, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('occurrence_id', occurrenceId)
        .order('checked_in_at', { ascending: false });
      if (error) throw new Error(`Failed to query attendance records from Supabase: ${error.message}`);

      const studentIds = Array.from(new Set((records || []).map((r: any) => r.student_id).filter(Boolean)));
      const [stuRes, enrRes] = await Promise.all([
        studentIds.length > 0
          ? supabase.from('students').select('*').in('id', studentIds)
          : Promise.resolve({ data: [] }),
        studentIds.length > 0
          ? supabase.from('student_enrollments').select('*').in('student_id', studentIds)
          : Promise.resolve({ data: [] }),
      ]);

      const stuMap = new Map<string, any>();
      for (const s of (stuRes.data || [])) stuMap.set(s.id, s);
      const enrMap = new Map<string, any>();
      for (const e of (enrRes.data || [])) enrMap.set(e.student_id, e);

      return (records || []).map((ar: any) => {
        const s = stuMap.get(ar.student_id);
        const enr = enrMap.get(ar.student_id);
        return {
          ...ar,
          school_id: s?.school_id || '',
          first_name: s?.first_name || '',
          middle_name: s?.middle_name || null,
          last_name: s?.last_name || '',
          photo_local_uri: s?.photo_storage_path || null,
          year_level: enr?.year_level || 1,
          section: enr?.section || '1A',
        };
      });
    }

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
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data: records, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('student_id', studentId)
        .order('checked_in_at', { ascending: false });
      if (error) throw new Error(`Failed to query student attendance history from Supabase: ${error.message}`);

      const occIds = Array.from(new Set((records || []).map((r: any) => r.occurrence_id).filter(Boolean)));
      let occs: any[] = [];
      let evs: any[] = [];
      if (occIds.length > 0) {
        const { data: occData } = await supabase.from('event_occurrences').select('*').in('id', occIds);
        occs = occData || [];
        const evIds = Array.from(new Set(occs.map((o: any) => o.event_id).filter(Boolean)));
        if (evIds.length > 0) {
          let evQuery = supabase.from('events').select('*').in('id', evIds);
          if (semesterId) evQuery = evQuery.eq('semester_id', semesterId);
          const { data: evData } = await evQuery;
          evs = evData || [];
        }
      }

      const occMap = new Map<string, any>();
      for (const o of occs) occMap.set(o.id, o);
      const evMap = new Map<string, any>();
      for (const e of evs) evMap.set(e.id, e);

      return (records || [])
        .filter((ar: any) => {
          const occ = occMap.get(ar.occurrence_id);
          const ev = occ ? evMap.get(occ.event_id) : null;
          return !semesterId || ev;
        })
        .map((ar: any) => {
          const occ = occMap.get(ar.occurrence_id);
          const ev = occ ? evMap.get(occ.event_id) : null;
          return {
            ...ar,
            event_title: ev?.title || 'Campus Event',
            occurrence_title: occ?.title || 'Attendance Session',
            occurs_on: occ?.occurs_on || '',
          };
        });
    }

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
