import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { StudentRecord, ProfileConfirmation } from '../../types/database';
import { getSchoolIdVariants, normalizeSchoolId } from '@/utilities/school-id-normalizer';

export interface StudentWithEnrollment extends StudentRecord {
  enrollment_id?: string;
  semester_id?: string;
  program_id?: string | null;
  year_level?: number;
  section?: string;
  enrollment_status?: string;
  card_uid?: string | null;
  card_status?: string | null;
}

export class StudentsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async createStudent(student: StudentRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO students (
        id, school_id, first_name, middle_name, last_name,
        photo_local_uri, photo_content_hash, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        student.id,
        student.school_id,
        student.first_name,
        student.middle_name || null,
        student.last_name,
        student.photo_local_uri || null,
        student.photo_content_hash || null,
        student.status,
        student.created_at,
        student.updated_at,
      ]
    );
  }

  public static async updateStudent(
    student: Partial<StudentRecord> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const updates: string[] = [];
    const params: unknown[] = [];

    if (student.first_name !== undefined) {
      updates.push('first_name = ?');
      params.push(student.first_name);
    }
    if (student.middle_name !== undefined) {
      updates.push('middle_name = ?');
      params.push(student.middle_name);
    }
    if (student.last_name !== undefined) {
      updates.push('last_name = ?');
      params.push(student.last_name);
    }
    if (student.photo_local_uri !== undefined) {
      updates.push('photo_local_uri = ?');
      params.push(student.photo_local_uri);
    }
    if (student.photo_content_hash !== undefined) {
      updates.push('photo_content_hash = ?');
      params.push(student.photo_content_hash);
    }
    if (student.status !== undefined) {
      updates.push('status = ?');
      params.push(student.status);
    }
    updates.push('updated_at = ?');
    params.push(student.updated_at || new Date().toISOString());

    params.push(student.id);
    await db.execute(
      `UPDATE students SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }

  public static async getStudentById(id: string, adapter?: DatabaseAdapter): Promise<StudentRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<StudentRecord>('SELECT * FROM students WHERE id = ?', [id]);
  }

  public static async getStudentBySchoolId(schoolId: string, adapter?: DatabaseAdapter): Promise<StudentRecord | null> {
    const db = await this.getDb(adapter);
    const clean = (schoolId || '').trim();
    if (!clean) return null;

    const variants = getSchoolIdVariants(clean);
    const placeholders = variants.map(() => '?').join(', ');
    return db.queryOne<StudentRecord>(
      `SELECT * FROM students WHERE school_id IN (${placeholders}) COLLATE NOCASE LIMIT 1`,
      variants
    );
  }

  public static async getStudentsByCanonicalSchoolId(
    schoolId: string,
    adapter?: DatabaseAdapter
  ): Promise<StudentRecord[]> {
    const db = await this.getDb(adapter);
    const clean = (schoolId || '').trim();
    if (!clean) return [];

    const variants = getSchoolIdVariants(clean);
    const placeholders = variants.map(() => '?').join(', ');
    return db.query<StudentRecord>(
      `SELECT * FROM students WHERE school_id IN (${placeholders}) COLLATE NOCASE`,
      variants
    );
  }

  public static async getStudents(
    filters?: {
      semesterId?: string;
      programId?: string;
      yearLevel?: number;
      section?: string;
      query?: string;
    },
    adapter?: DatabaseAdapter
  ): Promise<StudentWithEnrollment[]> {
    const db = await this.getDb(adapter);
    let sql = `
      SELECT s.*,
             e.id as enrollment_id, e.semester_id, e.program_id, e.year_level, e.section, e.enrollment_status,
             c.uid_normalized as card_uid, c.status as card_status
      FROM students s
      LEFT JOIN student_enrollments e ON e.student_id = s.id
        ${filters?.semesterId ? 'AND e.semester_id = ?' : ''}
      LEFT JOIN nfc_cards c ON c.student_id = s.id AND c.status = 'ACTIVE'
      WHERE s.deleted_at IS NULL
    `;
    const params: unknown[] = [];
    if (filters?.semesterId) {
      params.push(filters.semesterId);
    }
    if (filters?.programId) {
      sql += ' AND e.program_id = ?';
      params.push(filters.programId);
    }
    if (filters?.yearLevel !== undefined && filters?.yearLevel !== null) {
      sql += ' AND e.year_level = ?';
      params.push(filters.yearLevel);
    }
    if (filters?.section) {
      sql += ' AND e.section = ? COLLATE NOCASE';
      params.push(filters.section);
    }
    if (filters?.query) {
      sql += ' AND (s.school_id LIKE ? OR s.first_name LIKE ? OR s.last_name LIKE ?)';
      const q = `%${filters.query}%`;
      params.push(q, q, q);
    }
    sql += ' GROUP BY s.id ORDER BY s.last_name ASC, s.first_name ASC';

    return db.query<StudentWithEnrollment>(sql, params);
  }

  // --- PROFILE CONFIRMATIONS ---
  public static async createProfileConfirmation(
    confirmation: ProfileConfirmation,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO profile_confirmations (
        id, student_id, semester_id, status, snapshot_json, submitted_at, reviewed_at, reviewed_by_user_id, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(student_id, semester_id) DO UPDATE SET
        status = excluded.status,
        snapshot_json = excluded.snapshot_json,
        submitted_at = excluded.submitted_at,
        remarks = excluded.remarks`,
      [
        confirmation.id,
        confirmation.student_id,
        confirmation.semester_id,
        confirmation.status,
        confirmation.snapshot_json || null,
        confirmation.submitted_at || null,
        confirmation.reviewed_at || null,
        confirmation.reviewed_by_user_id || null,
        confirmation.remarks || null,
      ]
    );
  }

  public static async getProfileConfirmation(
    studentId: string,
    semesterId: string,
    adapter?: DatabaseAdapter
  ): Promise<ProfileConfirmation | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<ProfileConfirmation>(
      'SELECT * FROM profile_confirmations WHERE student_id = ? AND semester_id = ?',
      [studentId, semesterId]
    );
  }

  public static async updateProfileConfirmationStatus(
    id: string,
    status: ProfileConfirmation['status'],
    reviewedByUserId?: string,
    remarks?: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE profile_confirmations
       SET status = ?, reviewed_at = ?, reviewed_by_user_id = ?, remarks = ?
       WHERE id = ?`,
      [status, now, reviewedByUserId || null, remarks || null, id]
    );
  }

  public static async reconcileStudentId(
    oldId: string,
    newId: string,
    canonicalSchoolId?: string,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (oldId === newId) return;
    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      const oldStudent = await tx.queryOne<StudentRecord>('SELECT * FROM students WHERE id = ?', [oldId]);
      const targetStudent = await tx.queryOne<StudentRecord>('SELECT * FROM students WHERE id = ?', [newId]);

      if (!oldStudent && !targetStudent) {
        return;
      }

      const now = new Date().toISOString();
      const resolvedSchoolId = canonicalSchoolId
        ? normalizeSchoolId(canonicalSchoolId)
        : targetStudent
          ? normalizeSchoolId(targetStudent.school_id)
          : oldStudent
            ? normalizeSchoolId(oldStudent.school_id)
            : undefined;

      // 1. If target row does not exist in students table yet, create it first so foreign key checks succeed
      if (!targetStudent && oldStudent) {
        // Temporarily avoid unique school_id collision by prefixing old student's school_id
        await tx.execute('UPDATE students SET school_id = ? WHERE id = ?', [`tmp_${oldId}`, oldId]);

        await tx.execute(
          `INSERT INTO students (id, school_id, first_name, middle_name, last_name, photo_local_uri, photo_content_hash, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            newId,
            resolvedSchoolId || oldStudent.school_id,
            oldStudent.first_name,
            oldStudent.middle_name || null,
            oldStudent.last_name,
            oldStudent.photo_local_uri || null,
            oldStudent.photo_content_hash || null,
            oldStudent.status || 'ACTIVE',
            oldStudent.created_at || now,
            now,
          ]
        );
      }

      // 2. Now newId is guaranteed to exist in students table. Remap child records from oldId to newId
      await tx.execute('UPDATE student_enrollments SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE nfc_cards SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE attendance_records SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE student_obligations SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE payments SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE simulated_wallets SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE users SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE officer_appointments SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE activation_claims SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE activation_claims_audit SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE profile_confirmations SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute('UPDATE import_rows SET student_id = ? WHERE student_id = ?', [newId, oldId]);
      await tx.execute(
        'UPDATE sync_outbox SET entity_id = ? WHERE entity_id = ? AND entity_type = "STUDENT"',
        [newId, oldId]
      );
      await tx.execute(
        'UPDATE audit_events SET entity_id = ? WHERE entity_id = ? AND entity_type = "STUDENT"',
        [newId, oldId]
      );

      // 3. If targetStudent already existed, merge photo and school_id if needed
      if (targetStudent) {
        if (!targetStudent.photo_local_uri && oldStudent?.photo_local_uri) {
          await tx.execute(
            'UPDATE students SET photo_local_uri = ?, updated_at = ? WHERE id = ?',
            [oldStudent.photo_local_uri, now, newId]
          );
        }
        if (resolvedSchoolId) {
          await tx.execute(
            'UPDATE students SET school_id = ?, updated_at = ? WHERE id = ?',
            [resolvedSchoolId, now, newId]
          );
        }
      }

      // 4. Delete old row now that all child references have been remapped
      if (oldStudent) {
        await tx.execute('DELETE FROM students WHERE id = ?', [oldId]);
      }
    });
  }
}
