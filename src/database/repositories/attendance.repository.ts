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
    try {
      // 1. Verify occurrence existence (mandatory FK: occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id))
      const rawOccId = attempt.occurrence_id.startsWith('occ_')
        ? attempt.occurrence_id.replace(/^occ_/, '')
        : attempt.occurrence_id;
      const occRow = await db.queryOne<{ id: string }>(
        'SELECT id FROM event_occurrences WHERE id = ? OR id = ? LIMIT 1',
        [attempt.occurrence_id, rawOccId]
      );
      if (!occRow) {
        console.warn('[AttendanceRepository] Skipped logging attempt to SQLite: occurrence not found in local database', {
          occurrenceId: attempt.occurrence_id,
          result: attempt.result,
        });
        return;
      }
      const effectiveOccurrenceId = occRow.id;

      // 2. Verify optional foreign keys to prevent FK code 787
      let validStudentId: string | null = null;
      if (attempt.student_id) {
        const s = await db.queryOne<{ id: string }>('SELECT id FROM students WHERE id = ? LIMIT 1', [attempt.student_id]);
        if (s) validStudentId = s.id;
      }

      let validCardId: string | null = null;
      if (attempt.card_id) {
        const c = await db.queryOne<{ id: string }>('SELECT id FROM nfc_cards WHERE id = ? LIMIT 1', [attempt.card_id]);
        if (c) validCardId = c.id;
      }

      let validActorId: string | null = null;
      if (attempt.actor_user_id) {
        const u = await db.queryOne<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [attempt.actor_user_id]);
        if (u) validActorId = u.id;
      }

      // Ensure default device exists
      await db.execute(
        `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
         VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
        [attempt.occurred_at || new Date().toISOString()]
      );

      await db.execute(
        `INSERT INTO attendance_attempts (
          id, occurrence_id, student_id, card_id, uid_normalized,
          actor_user_id, device_id, result, photo_displayed, notes, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attempt.id,
          effectiveOccurrenceId,
          validStudentId,
          validCardId,
          attempt.uid_normalized,
          validActorId,
          'dev_default',
          attempt.result,
          attempt.photo_displayed,
          attempt.notes || null,
          attempt.occurred_at,
        ]
      );
    } catch (err: unknown) {
      console.error('[AttendanceRepository] Error logging attempt to SQLite:', {
        message: err instanceof Error ? err.message : String(err),
        result: attempt.result,
      });
    }
  }

  public static async recordAttendance(
    record: AttendanceRecord,
    actorUserId: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      // 1. Verify parent records exist in local SQLite (prevent code 787 foreign key failure)
      const rawOccId = record.occurrence_id.startsWith('occ_')
        ? record.occurrence_id.replace(/^occ_/, '')
        : record.occurrence_id;
      const occRow = await tx.queryOne<{ id: string }>(
        'SELECT id FROM event_occurrences WHERE id = ? OR id = ? LIMIT 1',
        [record.occurrence_id, rawOccId]
      );
      if (!occRow) {
        console.error('[AttendanceRepository] FK violation: occurrence not found in SQLite', {
          occurrenceId: record.occurrence_id,
          table: 'event_occurrences',
        });
        throw new Error(`[AttendanceRepository] Cannot record attendance offline: Event occurrence "${record.occurrence_id}" not found in local database. Please sync events first.`);
      }
      const effectiveOccurrenceId = occRow.id;

      const stuRow = await tx.queryOne<{ id: string }>(
        'SELECT id FROM students WHERE id = ? LIMIT 1',
        [record.student_id]
      );
      if (!stuRow) {
        console.error('[AttendanceRepository] FK violation: student not found in SQLite', {
          studentId: record.student_id,
          table: 'students',
        });
        throw new Error(`[AttendanceRepository] Cannot record attendance offline: Student "${record.student_id}" not found in local database. Please sync student directory first.`);
      }

      // Verify officer user exists in SQLite users table for attendance_audit (mandatory FK: actor_user_id NOT NULL REFERENCES users(id))
      let validActorId: string | null = null;
      if (actorUserId && actorUserId !== 'officer_user' && actorUserId !== 'officer_auto') {
        const userRow = await tx.queryOne<{ id: string }>('SELECT id FROM users WHERE id = ? LIMIT 1', [actorUserId]);
        if (userRow) {
          validActorId = userRow.id;
        }
      }
      if (!validActorId) {
        const activeUser = await tx.queryOne<{ id: string }>(
          'SELECT id FROM users WHERE account_status = "ACTIVE" ORDER BY created_at ASC LIMIT 1'
        );
        if (activeUser) {
          validActorId = activeUser.id;
        }
      }
      if (!validActorId) {
        console.error('[AttendanceRepository] FK violation: no active officer found in SQLite users', {
          actorUserId,
          table: 'users',
        });
        throw new Error(`[AttendanceRepository] Cannot record attendance audit offline: Officer account "${actorUserId}" is not provisioned in local database. Please log in online to initialize credentials.`);
      }

      // 2. Insert or update attendance record
      const checkpointId = record.checkpoint_id || 'default_in';
      const existing = await tx.query<AttendanceRecord>(
        `SELECT id FROM attendance_records WHERE occurrence_id = ? AND student_id = ? AND checkpoint_id = ? LIMIT 1`,
        [effectiveOccurrenceId, record.student_id, checkpointId]
      );

      if (existing.length > 0) {
        await tx.execute(
          `UPDATE attendance_records SET
            status = ?,
            checked_in_at = ?,
            client_scanned_at = ?,
            method = ?,
            identity_verified_by_user_id = ?,
            photo_checked = ?,
            updated_at = ?
           WHERE id = ?`,
          [
            record.status,
            record.checked_in_at || new Date().toISOString(),
            record.client_scanned_at || null,
            record.method || 'NFC',
            validActorId,
            record.photo_checked,
            record.updated_at,
            existing[0].id,
          ]
        );
      } else {
        await tx.execute(
          `INSERT INTO attendance_records (
            id, occurrence_id, student_id, checkpoint_id, status, checked_in_at, client_scanned_at, method,
            identity_verified_by_user_id, photo_checked, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.id,
            effectiveOccurrenceId,
            record.student_id,
            checkpointId,
            record.status,
            record.checked_in_at || new Date().toISOString(),
            record.client_scanned_at || null,
            record.method || 'NFC',
            validActorId,
            record.photo_checked,
            record.updated_at,
          ]
        );
      }

      // 3. Insert audit log
      const auditId = 'aud_' + Math.random().toString(36).substring(2, 10);
      await tx.execute(
        `INSERT INTO attendance_audit (
          id, attendance_id, action, old_status, new_status, actor_user_id, reason, created_at
        ) VALUES (?, ?, 'CHECK_IN', NULL, ?, ?, 'Officer identity confirmation', ?)`,
        [auditId, record.id, record.status, validActorId, record.updated_at]
      );

      // 4. Transactional Outbox write
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
            occurrence_id: effectiveOccurrenceId,
            student_id: record.student_id,
            checkpoint_id: checkpointId,
            status: record.status,
            checked_in_at: record.checked_in_at,
            client_scanned_at: record.client_scanned_at || record.checked_in_at,
            identity_verified_by_user_id: validActorId,
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
    checkpointIdOrAdapter?: string | DatabaseAdapter,
    adapter?: DatabaseAdapter
  ): Promise<AttendanceRecord | null> {
    const checkpointId = typeof checkpointIdOrAdapter === 'string' ? checkpointIdOrAdapter : undefined;
    const actualAdapter = (typeof checkpointIdOrAdapter === 'object' && checkpointIdOrAdapter !== null)
      ? checkpointIdOrAdapter
      : adapter;

    if (!actualAdapter && DataModeService.isDirectSupabase()) {
      let query = supabase
        .from('attendance_records')
        .select('*')
        .eq('occurrence_id', occurrenceId)
        .eq('student_id', studentId);

      if (checkpointId) {
        query = query.eq('checkpoint_id', checkpointId);
      }

      const { data, error } = await query.maybeSingle();
      if (error || !data) return null;
      return data as AttendanceRecord;
    }

    const db = await this.getDb(actualAdapter);
    if (checkpointId) {
      return db.queryOne<AttendanceRecord>(
        'SELECT * FROM attendance_records WHERE occurrence_id = ? AND student_id = ? AND (checkpoint_id = ? OR checkpoint_id IS NULL)',
        [occurrenceId, studentId, checkpointId]
      );
    }
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
