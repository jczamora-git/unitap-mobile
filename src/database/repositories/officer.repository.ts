import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type {
  OfficerAppointmentRecord,
  OfficerStatus,
} from '@/types/database';

export interface OfficerListRecord extends OfficerAppointmentRecord {
  school_id?: string | null;
  student_number?: string | null;
  program_code?: string | null;
  username?: string | null;
}

export class OfficerRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || (await getDatabase());
  }

  public static async createAppointment(
    record: OfficerAppointmentRecord,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO officer_appointments (
        id, user_id, student_id, full_name, email, permission_preset,
        custom_permissions_json, academic_year_id, semester_id,
        appointment_start, appointment_end, scope_type, scope_id,
        status, invitation_code, invitation_sent_at, assigned_by_user_id,
        created_at, updated_at, suspended_at, revoked_at, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.user_id || null,
        record.student_id || null,
        record.full_name,
        record.email,
        record.permission_preset,
        record.custom_permissions_json || '[]',
        record.academic_year_id || null,
        record.semester_id || null,
        record.appointment_start,
        record.appointment_end,
        record.scope_type,
        record.scope_id || null,
        record.status,
        record.invitation_code || null,
        record.invitation_sent_at || null,
        record.assigned_by_user_id,
        record.created_at,
        record.updated_at,
        record.suspended_at || null,
        record.revoked_at || null,
        record.last_activity_at || null,
      ]
    );
  }

  public static async getAppointmentById(
    id: string,
    adapter?: DatabaseAdapter
  ): Promise<OfficerAppointmentRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<OfficerAppointmentRecord>(
      'SELECT * FROM officer_appointments WHERE id = ?',
      [id]
    );
  }

  public static async getAppointmentByUserId(
    userId: string,
    adapter?: DatabaseAdapter
  ): Promise<OfficerAppointmentRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<OfficerAppointmentRecord>(
      'SELECT * FROM officer_appointments WHERE user_id = ? AND status IN (\'ACTIVE\', \'SUSPENDED\') ORDER BY created_at DESC',
      [userId]
    );
  }

  public static async getAppointmentByStudentId(
    studentId: string,
    adapter?: DatabaseAdapter
  ): Promise<OfficerAppointmentRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<OfficerAppointmentRecord>(
      'SELECT * FROM officer_appointments WHERE student_id = ? AND status IN (\'ACTIVE\', \'PENDING\', \'SUSPENDED\') ORDER BY created_at DESC',
      [studentId]
    );
  }

  public static async getAppointments(
    filter?: { status?: OfficerStatus; search?: string },
    adapter?: DatabaseAdapter
  ): Promise<OfficerListRecord[]> {
    const db = await this.getDb(adapter);
    let sql = `
      SELECT 
        oa.*,
        s.school_id,
        u.username
      FROM officer_appointments oa
      LEFT JOIN students s ON oa.student_id = s.id
      LEFT JOIN users u ON oa.user_id = u.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filter?.status) {
      sql += ' AND oa.status = ?';
      params.push(filter.status);
    }

    if (filter?.search) {
      const term = `%${filter.search.trim()}%`;
      sql += ' AND (oa.full_name LIKE ? OR oa.email LIKE ? OR s.school_id LIKE ?)';
      params.push(term, term, term);
    }

    sql += ' ORDER BY oa.created_at DESC';

    return db.query<OfficerListRecord>(sql, params);
  }

  public static async updateAppointment(
    id: string,
    updates: Partial<OfficerAppointmentRecord>,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const setClauses: string[] = [];
    const params: any[] = [];

    for (const [key, val] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      params.push(val);
    }

    setClauses.push('updated_at = ?');
    params.push(new Date().toISOString());

    params.push(id);
    await db.execute(
      `UPDATE officer_appointments SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
  }

  public static async suspendAppointment(
    id: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.updateAppointment(id, { status: 'SUSPENDED', suspended_at: now }, adapter);
  }

  public static async revokeAppointment(
    id: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const now = new Date().toISOString();
    const appt = await this.getAppointmentById(id, adapter);
    if (!appt) return;

    await this.updateAppointment(id, { status: 'REVOKED', revoked_at: now }, adapter);

    // If linked to user, revoke active OFFICER role, leaving STUDENT role untouched
    if (appt.user_id) {
      await db.execute(
        `UPDATE user_roles SET revoked_at = ? 
         WHERE user_id = ? AND role = 'OFFICER' AND revoked_at IS NULL`,
        [now, appt.user_id]
      );
    }
  }

  public static async activatePendingAppointmentForStudent(
    studentId: string,
    userId: string,
    adapter?: DatabaseAdapter
  ): Promise<OfficerAppointmentRecord | null> {
    const db = await this.getDb(adapter);
    const appt = await this.getAppointmentByStudentId(studentId, adapter);
    if (!appt || appt.status !== 'PENDING') return null;

    const now = new Date().toISOString();
    await db.execute(
      `UPDATE officer_appointments 
       SET user_id = ?, status = 'ACTIVE', updated_at = ? 
       WHERE id = ?`,
      [userId, now, appt.id]
    );

    // Assign OFFICER role to user if not already assigned
    const roleId = 'rol_off_' + Math.random().toString(36).substring(2, 9);
    await db.execute(
      `INSERT INTO user_roles (id, user_id, role, semester_id, assigned_by_user_id, assigned_at)
       VALUES (?, ?, 'OFFICER', ?, ?, ?)`,
      [roleId, userId, appt.semester_id || null, appt.assigned_by_user_id, now]
    );

    return this.getAppointmentById(appt.id, adapter);
  }

  public static async searchStudentsForOfficer(
    query: string,
    registeredOnly?: boolean | null,
    limit = 10,
    adapter?: DatabaseAdapter
  ): Promise<any[]> {
    const db = await this.getDb(adapter);
    const clean = query && query.trim() ? `%${query.trim()}%` : '%';
    let sql = `
      SELECT 
        s.id as student_id,
        s.school_id,
        s.first_name,
        s.middle_name,
        s.last_name,
        u.id as user_id,
        u.username,
        u.account_status,
        CASE WHEN u.id IS NOT NULL AND u.account_status = 'ACTIVE' THEN 1 ELSE 0 END as is_registered,
        (SELECT role FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'OFFICER' AND ur.revoked_at IS NULL) as is_officer
      FROM students s
      LEFT JOIN users u ON u.student_id = s.id
      WHERE (
        s.school_id LIKE ? 
        OR s.first_name LIKE ? 
        OR s.last_name LIKE ?
        OR (s.first_name || ' ' || s.last_name) LIKE ?
        OR (s.last_name || ', ' || s.first_name) LIKE ?
        OR u.username LIKE ?
      )
    `;

    if (registeredOnly === true) {
      sql += ' AND u.id IS NOT NULL AND u.account_status = \'ACTIVE\'';
    } else if (registeredOnly === false) {
      sql += ' AND (u.id IS NULL OR u.account_status != \'ACTIVE\')';
    }

    sql += ` ORDER BY s.last_name ASC, s.first_name ASC LIMIT ${Math.max(1, Math.min(limit, 20))}`;
    return db.query(sql, [clean, clean, clean, clean, clean, clean]);
  }
}

