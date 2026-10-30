import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { AcademicYear, Semester, Program, StudentEnrollment } from '../../types/database';

export class AcademicRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  // --- ACADEMIC YEARS ---
  public static async createYear(year: AcademicYear, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES (?, ?, ?, ?, ?)`,
      [year.id, year.label, year.starts_on, year.ends_on, year.status]
    );
  }

  public static async getYears(adapter?: DatabaseAdapter): Promise<AcademicYear[]> {
    const db = await this.getDb(adapter);
    return db.query<AcademicYear>('SELECT * FROM academic_years ORDER BY starts_on DESC');
  }

  public static async getYearById(id: string, adapter?: DatabaseAdapter): Promise<AcademicYear | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<AcademicYear>('SELECT * FROM academic_years WHERE id = ?', [id]);
  }

  // --- SEMESTERS ---
  public static async createSemester(semester: Semester, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [semester.id, semester.academic_year_id, semester.term, semester.starts_on, semester.ends_on, semester.status]
    );
  }

  public static async getSemesters(adapter?: DatabaseAdapter): Promise<Semester[]> {
    const db = await this.getDb(adapter);
    return db.query<Semester>('SELECT * FROM semesters ORDER BY starts_on DESC');
  }

  public static async getSemesterById(id: string, adapter?: DatabaseAdapter): Promise<Semester | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<Semester>('SELECT * FROM semesters WHERE id = ?', [id]);
  }

  public static async getActiveSemester(adapter?: DatabaseAdapter): Promise<Semester | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<Semester>("SELECT * FROM semesters WHERE status = 'ACTIVE' LIMIT 1");
  }

  public static async setActiveSemester(semesterId: string, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.transaction(async (tx) => {
      // Set any existing ACTIVE semester to CLOSED
      await tx.execute("UPDATE semesters SET status = 'CLOSED' WHERE status = 'ACTIVE'");
      // Set the target semester to ACTIVE
      await tx.execute("UPDATE semesters SET status = 'ACTIVE' WHERE id = ?", [semesterId]);
    });
  }

  // --- PROGRAMS ---
  public static async upsertProgram(program: Program, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO programs (id, code, name, is_active)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, is_active=excluded.is_active`,
      [program.id, program.code, program.name, program.is_active]
    );
  }

  public static async getPrograms(adapter?: DatabaseAdapter): Promise<Program[]> {
    const db = await this.getDb(adapter);
    return db.query<Program>('SELECT * FROM programs WHERE is_active = 1 ORDER BY code ASC');
  }

  // --- ENROLLMENTS ---
  public static async createEnrollment(enrollment: StudentEnrollment, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO student_enrollments (
        id, student_id, semester_id, program_id, year_level, section,
        enrollment_status, first_name_snapshot, middle_name_snapshot, last_name_snapshot, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enrollment.id,
        enrollment.student_id,
        enrollment.semester_id,
        enrollment.program_id || null,
        enrollment.year_level,
        enrollment.section,
        enrollment.enrollment_status,
        enrollment.first_name_snapshot,
        enrollment.middle_name_snapshot || null,
        enrollment.last_name_snapshot,
        enrollment.updated_at,
      ]
    );
  }

  public static async getEnrollmentsForStudent(studentId: string, adapter?: DatabaseAdapter): Promise<StudentEnrollment[]> {
    const db = await this.getDb(adapter);
    return db.query<StudentEnrollment>(
      'SELECT * FROM student_enrollments WHERE student_id = ? ORDER BY updated_at DESC',
      [studentId]
    );
  }

  public static async getStudentEnrollmentInSemester(
    studentId: string,
    semesterId: string,
    adapter?: DatabaseAdapter
  ): Promise<StudentEnrollment | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<StudentEnrollment>(
      'SELECT * FROM student_enrollments WHERE student_id = ? AND semester_id = ?',
      [studentId, semesterId]
    );
  }
}

