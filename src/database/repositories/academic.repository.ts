import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type {
  AcademicYear,
  Semester,
  Program,
  StudentEnrollment,
  EventCategory,
  YearLevel,
  SectionRecord,
} from '../../types/database';

export class AcademicRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  // ============================================================================
  // 1. ACADEMIC YEARS
  // ============================================================================

  public static async createYear(year: AcademicYear, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES (?, ?, ?, ?, ?)`,
      [year.id, year.label.trim(), year.starts_on, year.ends_on, year.status]
    );
  }

  public static async updateYear(
    year: Partial<AcademicYear> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const updates: string[] = [];
    const params: unknown[] = [];

    if (year.label !== undefined) {
      updates.push('label = ?');
      params.push(year.label.trim());
    }
    if (year.starts_on !== undefined) {
      updates.push('starts_on = ?');
      params.push(year.starts_on);
    }
    if (year.ends_on !== undefined) {
      updates.push('ends_on = ?');
      params.push(year.ends_on);
    }
    if (year.status !== undefined) {
      updates.push('status = ?');
      params.push(year.status);
    }

    if (updates.length === 0) return;
    params.push(year.id);
    await db.execute(`UPDATE academic_years SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  public static async getYears(adapter?: DatabaseAdapter): Promise<AcademicYear[]> {
    const db = await this.getDb(adapter);
    return db.query<AcademicYear>('SELECT * FROM academic_years ORDER BY starts_on DESC');
  }

  public static async getYearById(id: string, adapter?: DatabaseAdapter): Promise<AcademicYear | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<AcademicYear>('SELECT * FROM academic_years WHERE id = ?', [id]);
  }

  public static async getYearByLabel(label: string, adapter?: DatabaseAdapter): Promise<AcademicYear | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<AcademicYear>('SELECT * FROM academic_years WHERE lower(label) = lower(?) LIMIT 1', [label.trim()]);
  }

  public static async getActiveYear(adapter?: DatabaseAdapter): Promise<AcademicYear | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<AcademicYear>("SELECT * FROM academic_years WHERE status = 'ACTIVE' LIMIT 1");
  }

  public static async setYearStatus(
    yearId: string,
    status: AcademicYear['status'],
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const mappedStatus = status === 'CLOSED' ? 'ARCHIVED' : (status === 'UPCOMING' ? 'PLANNED' : status);
    if (mappedStatus === 'ACTIVE') {
      await db.transaction(async (tx) => {
        await tx.execute("UPDATE academic_years SET status = 'ARCHIVED' WHERE status = 'ACTIVE'");
        await tx.execute('UPDATE academic_years SET status = ? WHERE id = ?', [mappedStatus, yearId]);
      });
    } else {
      await db.execute('UPDATE academic_years SET status = ? WHERE id = ?', [mappedStatus, yearId]);
    }
  }

  // ============================================================================
  // 2. SEMESTERS
  // ============================================================================

  public static async createSemester(semester: Semester, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [semester.id, semester.academic_year_id, semester.term, semester.starts_on, semester.ends_on, semester.status]
    );
  }

  public static async updateSemester(
    semester: Partial<Semester> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const updates: string[] = [];
    const params: unknown[] = [];

    if (semester.academic_year_id !== undefined) {
      updates.push('academic_year_id = ?');
      params.push(semester.academic_year_id);
    }
    if (semester.term !== undefined) {
      updates.push('term = ?');
      params.push(semester.term);
    }
    if (semester.starts_on !== undefined) {
      updates.push('starts_on = ?');
      params.push(semester.starts_on);
    }
    if (semester.ends_on !== undefined) {
      updates.push('ends_on = ?');
      params.push(semester.ends_on);
    }
    if (semester.status !== undefined) {
      updates.push('status = ?');
      params.push(semester.status);
    }

    if (updates.length === 0) return;
    params.push(semester.id);
    await db.execute(`UPDATE semesters SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  public static async getSemesters(adapter?: DatabaseAdapter): Promise<Semester[]> {
    const db = await this.getDb(adapter);
    return db.query<Semester>('SELECT * FROM semesters ORDER BY starts_on DESC');
  }

  public static async getSemestersByYear(academicYearId: string, adapter?: DatabaseAdapter): Promise<Semester[]> {
    const db = await this.getDb(adapter);
    return db.query<Semester>('SELECT * FROM semesters WHERE academic_year_id = ? ORDER BY starts_on ASC', [academicYearId]);
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

  public static async getSemesterStats(
    semesterId: string,
    adapter?: DatabaseAdapter
  ): Promise<{ enrolledCount: number; eventCount: number }> {
    const db = await this.getDb(adapter);
    const enrolledRow = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM student_enrollments WHERE semester_id = ?',
      [semesterId]
    );
    const eventRow = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM events WHERE semester_id = ?',
      [semesterId]
    );
    return {
      enrolledCount: enrolledRow?.count || 0,
      eventCount: eventRow?.count || 0,
    };
  }

  // ============================================================================
  // 3. EVENT CATEGORIES
  // ============================================================================

  public static async createEventCategory(cat: EventCategory, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO event_categories (id, name, description, code, status, sort_order, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cat.id,
        cat.name.trim(),
        cat.description?.trim() || null,
        cat.code.trim().toUpperCase(),
        cat.status || 'ACTIVE',
        cat.sort_order || 0,
        cat.created_by_user_id || null,
        cat.created_at,
        cat.updated_at,
      ]
    );
  }

  public static async updateEventCategory(
    cat: Partial<EventCategory> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const updates: string[] = [];
    const params: unknown[] = [];

    if (cat.name !== undefined) {
      updates.push('name = ?');
      params.push(cat.name.trim());
    }
    if (cat.description !== undefined) {
      updates.push('description = ?');
      params.push(cat.description?.trim() || null);
    }
    if (cat.code !== undefined) {
      updates.push('code = ?');
      params.push(cat.code.trim().toUpperCase());
    }
    if (cat.status !== undefined) {
      updates.push('status = ?');
      params.push(cat.status);
    }
    if (cat.sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(cat.sort_order);
    }
    updates.push('updated_at = ?');
    params.push(cat.updated_at || new Date().toISOString());

    params.push(cat.id);
    await db.execute(`UPDATE event_categories SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  public static async getEventCategories(includeInactive = false, adapter?: DatabaseAdapter): Promise<EventCategory[]> {
    const db = await this.getDb(adapter);
    const sql = includeInactive
      ? 'SELECT * FROM event_categories ORDER BY sort_order ASC, name ASC'
      : "SELECT * FROM event_categories WHERE status = 'ACTIVE' ORDER BY sort_order ASC, name ASC";
    return db.query<EventCategory>(sql);
  }

  public static async getEventCategoryById(id: string, adapter?: DatabaseAdapter): Promise<EventCategory | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<EventCategory>('SELECT * FROM event_categories WHERE id = ?', [id]);
  }

  public static async getEventCategoryByName(name: string, adapter?: DatabaseAdapter): Promise<EventCategory | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<EventCategory>('SELECT * FROM event_categories WHERE lower(name) = lower(?) LIMIT 1', [name.trim()]);
  }

  public static async getEventCategoryUsageCount(categoryId: string, adapter?: DatabaseAdapter): Promise<number> {
    const db = await this.getDb(adapter);
    const cat = await this.getEventCategoryById(categoryId, adapter);
    if (!cat) return 0;
    const row = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM events WHERE category_id = ? OR lower(event_type) = lower(?) OR event_type = ?',
      [categoryId, cat.name, cat.code]
    );
    return row?.count || 0;
  }

  // ============================================================================
  // 4. YEAR LEVELS
  // ============================================================================

  public static async createYearLevel(yl: YearLevel, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO year_levels (id, level_number, display_name, status, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [yl.id, yl.level_number, yl.display_name.trim(), yl.status || 'ACTIVE', yl.sort_order || 0, yl.created_at, yl.updated_at]
    );
  }

  public static async updateYearLevel(
    yl: Partial<YearLevel> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const updates: string[] = [];
    const params: unknown[] = [];

    if (yl.display_name !== undefined) {
      updates.push('display_name = ?');
      params.push(yl.display_name.trim());
    }
    if (yl.level_number !== undefined) {
      updates.push('level_number = ?');
      params.push(yl.level_number);
    }
    if (yl.status !== undefined) {
      updates.push('status = ?');
      params.push(yl.status);
    }
    if (yl.sort_order !== undefined) {
      updates.push('sort_order = ?');
      params.push(yl.sort_order);
    }
    updates.push('updated_at = ?');
    params.push(yl.updated_at || new Date().toISOString());

    params.push(yl.id);
    await db.execute(`UPDATE year_levels SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  public static async getYearLevels(includeInactive = false, adapter?: DatabaseAdapter): Promise<YearLevel[]> {
    const db = await this.getDb(adapter);
    const sql = includeInactive
      ? 'SELECT * FROM year_levels ORDER BY sort_order ASC, level_number ASC'
      : "SELECT * FROM year_levels WHERE status = 'ACTIVE' ORDER BY sort_order ASC, level_number ASC";
    return db.query<YearLevel>(sql);
  }

  public static async getYearLevelById(id: string, adapter?: DatabaseAdapter): Promise<YearLevel | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<YearLevel>('SELECT * FROM year_levels WHERE id = ?', [id]);
  }

  public static async getYearLevelByNumber(num: number, adapter?: DatabaseAdapter): Promise<YearLevel | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<YearLevel>('SELECT * FROM year_levels WHERE level_number = ? LIMIT 1', [num]);
  }

  // ============================================================================
  // 5. SECTIONS (One Year Level -> Many Sections)
  // ============================================================================

  public static async createSection(sec: SectionRecord, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO sections (id, section_name, year_level_id, program_id, academic_year_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sec.id,
        sec.section_name.trim(),
        sec.year_level_id,
        sec.program_id || null,
        sec.academic_year_id || null,
        sec.status || 'ACTIVE',
        sec.created_at,
        sec.updated_at,
      ]
    );
  }

  public static async updateSection(
    sec: Partial<SectionRecord> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const db = await this.getDb(adapter);
    const updates: string[] = [];
    const params: unknown[] = [];

    if (sec.section_name !== undefined) {
      updates.push('section_name = ?');
      params.push(sec.section_name.trim());
    }
    if (sec.year_level_id !== undefined) {
      updates.push('year_level_id = ?');
      params.push(sec.year_level_id);
    }
    if (sec.program_id !== undefined) {
      updates.push('program_id = ?');
      params.push(sec.program_id || null);
    }
    if (sec.academic_year_id !== undefined) {
      updates.push('academic_year_id = ?');
      params.push(sec.academic_year_id || null);
    }
    if (sec.status !== undefined) {
      updates.push('status = ?');
      params.push(sec.status);
    }
    updates.push('updated_at = ?');
    params.push(sec.updated_at || new Date().toISOString());

    params.push(sec.id);
    await db.execute(`UPDATE sections SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  public static async getSections(
    filters?: {
      yearLevelId?: string;
      programId?: string;
      academicYearId?: string;
      includeInactive?: boolean;
    },
    adapter?: DatabaseAdapter
  ): Promise<(SectionRecord & { year_display?: string; program_code?: string })[]> {
    const db = await this.getDb(adapter);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!filters?.includeInactive) {
      conditions.push("s.status = 'ACTIVE'");
    }
    if (filters?.yearLevelId) {
      conditions.push('s.year_level_id = ?');
      params.push(filters.yearLevelId);
    }
    if (filters?.programId) {
      conditions.push('s.program_id = ?');
      params.push(filters.programId);
    }
    if (filters?.academicYearId) {
      conditions.push('s.academic_year_id = ?');
      params.push(filters.academicYearId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `
      SELECT s.*, yl.display_name as year_display, p.code as program_code
      FROM sections s
      LEFT JOIN year_levels yl ON yl.id = s.year_level_id
      LEFT JOIN programs p ON p.id = s.program_id
      ${whereClause}
      ORDER BY yl.sort_order ASC, s.section_name ASC
    `;
    return db.query(sql, params);
  }

  public static async getSectionById(id: string, adapter?: DatabaseAdapter): Promise<SectionRecord | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<SectionRecord>('SELECT * FROM sections WHERE id = ?', [id]);
  }

  public static async getSectionByName(
    name: string,
    yearLevelId?: string,
    academicYearId?: string,
    programId?: string,
    adapter?: DatabaseAdapter
  ): Promise<SectionRecord | null> {
    const db = await this.getDb(adapter);
    const conditions = ['lower(section_name) = lower(?)'];
    const params: unknown[] = [name.trim()];

    if (yearLevelId) {
      conditions.push('year_level_id = ?');
      params.push(yearLevelId);
    }
    if (academicYearId) {
      conditions.push('(academic_year_id = ? OR academic_year_id IS NULL)');
      params.push(academicYearId);
    }
    if (programId) {
      conditions.push('(program_id = ? OR program_id IS NULL)');
      params.push(programId);
    }

    const sql = `SELECT * FROM sections WHERE ${conditions.join(' AND ')} LIMIT 1`;
    return db.queryOne<SectionRecord>(sql, params);
  }

  public static async getSectionEnrollmentCount(sectionId: string, adapter?: DatabaseAdapter): Promise<number> {
    const db = await this.getDb(adapter);
    const sec = await this.getSectionById(sectionId, adapter);
    if (!sec) return 0;
    const row = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM student_enrollments WHERE section_id = ? OR lower(section) = lower(?)',
      [sectionId, sec.section_name]
    );
    return row?.count || 0;
  }

  // ============================================================================
  // 6. PROGRAMS
  // ============================================================================

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

  public static async getProgramById(id: string, adapter?: DatabaseAdapter): Promise<Program | null> {
    const db = await this.getDb(adapter);
    return db.queryOne<Program>('SELECT * FROM programs WHERE id = ?', [id]);
  }

  // ============================================================================
  // 7. ENROLLMENTS
  // ============================================================================

  public static async createEnrollment(enrollment: StudentEnrollment, adapter?: DatabaseAdapter): Promise<void> {
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO student_enrollments (
        id, student_id, semester_id, program_id, year_level, section,
        year_level_id, section_id, enrollment_status, first_name_snapshot,
        middle_name_snapshot, last_name_snapshot, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        enrollment.id,
        enrollment.student_id,
        enrollment.semester_id,
        enrollment.program_id || null,
        enrollment.year_level,
        enrollment.section,
        enrollment.year_level_id || null,
        enrollment.section_id || null,
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
