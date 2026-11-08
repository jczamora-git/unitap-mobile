import { getDatabase } from '../database';
import { supabase } from '@/integrations/supabase/client';
import { DataModeService } from '@/services/data-mode.service';
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

  /**
   * Evaluates whether a query should target Supabase directly.
   * Direct Supabase execution is only allowed when:
   * 1. No explicit database adapter was passed (an adapter indicates a local/transactional operation).
   * 2. Direct Supabase Mode is active (VITE_DATA_MODE=supabase_direct).
   * 3. SupabaseAuthService initialization is complete.
   * 4. A valid authenticated cloud session exists.
   */
  private static async isDirectSupabaseAllowed(adapter?: DatabaseAdapter): Promise<boolean> {
    if (adapter) return false;
    return DataModeService.isDirectSupabase();
  }

  // ============================================================================
  // 1. ACADEMIC YEARS
  // ============================================================================

  public static async createYear(year: AcademicYear, adapter?: DatabaseAdapter): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('academic_years').insert({
        id: year.id,
        label: year.label.trim(),
        starts_on: year.starts_on,
        ends_on: year.ends_on,
        status: year.status,
        created_at: (year as any).created_at || now,
        updated_at: (year as any).updated_at || now,
      });
      if (error) {
        throw new Error(`Failed to insert academic year into Supabase: ${error.message}`);
      }
      return;
    }

    try {
      const db = await this.getDb(adapter);
      await db.execute(
        `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
         VALUES (?, ?, ?, ?, ?)`,
        [year.id, year.label.trim(), year.starts_on, year.ends_on, year.status]
      );
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache academic year in SQLite:', err);
    }
  }

  public static async updateYear(
    year: Partial<AcademicYear> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      const remoteUpdates: Record<string, unknown> = {
        updated_at: (year as any).updated_at || now,
      };
      if (year.label !== undefined) remoteUpdates.label = year.label.trim();
      if (year.starts_on !== undefined) remoteUpdates.starts_on = year.starts_on;
      if (year.ends_on !== undefined) remoteUpdates.ends_on = year.ends_on;
      if (year.status !== undefined) remoteUpdates.status = year.status;

      const { error } = await supabase.from('academic_years').update(remoteUpdates).eq('id', year.id);
      if (error) {
        throw new Error(`Failed to update academic year in Supabase: ${error.message}`);
      }
      return;
    }

    try {
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

      if (updates.length > 0) {
        params.push(year.id);
        await db.execute(`UPDATE academic_years SET ${updates.join(', ')} WHERE id = ?`, params);
      }
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache academic year update in SQLite:', err);
    }
  }

  public static async getYears(adapter?: DatabaseAdapter): Promise<AcademicYear[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return [];
      }
      const { data, error } = await supabase.from('academic_years').select('*').order('starts_on', { ascending: false });
      if (error) throw new Error(`Failed to query academic years from Supabase: ${error.message}`);
      return (data || []) as AcademicYear[];
    }
    const db = await this.getDb(adapter);
    return db.query<AcademicYear>('SELECT * FROM academic_years ORDER BY starts_on DESC');
  }

  public static async getYearById(id: string, adapter?: DatabaseAdapter): Promise<AcademicYear | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase.from('academic_years').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`Failed to query academic year from Supabase: ${error.message}`);
      return (data || null) as AcademicYear | null;
    }
    const db = await this.getDb(adapter);
    return db.queryOne<AcademicYear>('SELECT * FROM academic_years WHERE id = ?', [id]);
  }

  public static async getYearByLabel(label: string, adapter?: DatabaseAdapter): Promise<AcademicYear | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase.from('academic_years').select('*').ilike('label', label.trim()).maybeSingle();
      if (error) throw new Error(`Failed to query academic year from Supabase: ${error.message}`);
      return (data || null) as AcademicYear | null;
    }
    const db = await this.getDb(adapter);
    return db.queryOne<AcademicYear>('SELECT * FROM academic_years WHERE lower(label) = lower(?) LIMIT 1', [label.trim()]);
  }

  public static async getActiveYear(adapter?: DatabaseAdapter): Promise<AcademicYear | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase.from('academic_years').select('*').eq('status', 'ACTIVE').limit(1).maybeSingle();
      if (error) throw new Error(`Failed to query active academic year from Supabase: ${error.message}`);
      return (data || null) as AcademicYear | null;
    }
    const db = await this.getDb(adapter);
    return db.queryOne<AcademicYear>("SELECT * FROM academic_years WHERE status = 'ACTIVE' LIMIT 1");
  }

  public static async setYearStatus(
    yearId: string,
    status: AcademicYear['status'],
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const now = new Date().toISOString();
    const mappedStatus = status === 'CLOSED' ? 'ARCHIVED' : (status === 'UPCOMING' ? 'PLANNED' : status);

    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      if (mappedStatus === 'ACTIVE') {
        await supabase.from('academic_years').update({ status: 'ARCHIVED', updated_at: now }).eq('status', 'ACTIVE');
      }
      const { error } = await supabase.from('academic_years').update({ status: mappedStatus, updated_at: now }).eq('id', yearId);
      if (error) {
        throw new Error(`Failed to set academic year status in Supabase: ${error.message}`);
      }
    }

    try {
      const db = await this.getDb(adapter);
      if (mappedStatus === 'ACTIVE') {
        await db.transaction(async (tx) => {
          await tx.execute("UPDATE academic_years SET status = 'ARCHIVED' WHERE status = 'ACTIVE'");
          await tx.execute('UPDATE academic_years SET status = ? WHERE id = ?', [mappedStatus, yearId]);
        });
      } else {
        await db.execute('UPDATE academic_years SET status = ? WHERE id = ?', [mappedStatus, yearId]);
      }
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache academic year status in SQLite:', err);
    }
  }

  // ============================================================================
  // 2. SEMESTERS
  // ============================================================================

  public static async createSemester(semester: Semester, adapter?: DatabaseAdapter): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('semesters').insert({
        id: semester.id,
        academic_year_id: semester.academic_year_id,
        term: semester.term,
        starts_on: semester.starts_on,
        ends_on: semester.ends_on,
        status: semester.status,
        created_at: (semester as any).created_at || now,
        updated_at: (semester as any).updated_at || now,
      });
      if (error) {
        throw new Error(`Failed to insert semester into Supabase: ${error.message}`);
      }
      return;
    }

    try {
      const db = await this.getDb(adapter);
      await db.execute(
        `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [semester.id, semester.academic_year_id, semester.term, semester.starts_on, semester.ends_on, semester.status]
      );
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache semester in SQLite:', err);
    }
  }

  public static async updateSemester(
    semester: Partial<Semester> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      const remoteUpdates: Record<string, unknown> = {
        updated_at: (semester as any).updated_at || now,
      };
      if (semester.academic_year_id !== undefined) remoteUpdates.academic_year_id = semester.academic_year_id;
      if (semester.term !== undefined) remoteUpdates.term = semester.term;
      if (semester.starts_on !== undefined) remoteUpdates.starts_on = semester.starts_on;
      if (semester.ends_on !== undefined) remoteUpdates.ends_on = semester.ends_on;
      if (semester.status !== undefined) remoteUpdates.status = semester.status;

      const { error } = await supabase.from('semesters').update(remoteUpdates).eq('id', semester.id);
      if (error) {
        throw new Error(`Failed to update semester in Supabase: ${error.message}`);
      }
      return;
    }

    try {
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

      if (updates.length > 0) {
        params.push(semester.id);
        await db.execute(`UPDATE semesters SET ${updates.join(', ')} WHERE id = ?`, params);
      }
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache semester update in SQLite:', err);
    }
  }

  public static async getSemesters(adapter?: DatabaseAdapter): Promise<Semester[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return [];
      }
      const { data, error } = await supabase.from('semesters').select('*').order('starts_on', { ascending: false });
      if (error) throw new Error(`Failed to query semesters from Supabase: ${error.message}`);
      return (data || []) as Semester[];
    }
    const db = await this.getDb(adapter);
    return db.query<Semester>('SELECT * FROM semesters ORDER BY starts_on DESC');
  }

  public static async getSemestersByYear(academicYearId: string, adapter?: DatabaseAdapter): Promise<Semester[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return [];
      }
      const { data, error } = await supabase.from('semesters').select('*').eq('academic_year_id', academicYearId).order('starts_on', { ascending: true });
      if (error) throw new Error(`Failed to query semesters by year from Supabase: ${error.message}`);
      return (data || []) as Semester[];
    }
    const db = await this.getDb(adapter);
    return db.query<Semester>('SELECT * FROM semesters WHERE academic_year_id = ? ORDER BY starts_on ASC', [academicYearId]);
  }

  public static async getSemesterById(id: string, adapter?: DatabaseAdapter): Promise<Semester | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase.from('semesters').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(`Failed to query semester by ID from Supabase: ${error.message}`);
      return (data || null) as Semester | null;
    }
    const db = await this.getDb(adapter);
    return db.queryOne<Semester>('SELECT * FROM semesters WHERE id = ?', [id]);
  }

  public static async getActiveSemester(adapter?: DatabaseAdapter): Promise<Semester | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase.from('semesters').select('*').eq('status', 'ACTIVE').limit(1).maybeSingle();
      if (error) throw new Error(`Failed to query active semester from Supabase: ${error.message}`);
      return (data || null) as Semester | null;
    }
    const db = await this.getDb(adapter);
    return db.queryOne<Semester>("SELECT * FROM semesters WHERE status = 'ACTIVE' LIMIT 1");
  }

  public static async setActiveSemester(semesterId: string, adapter?: DatabaseAdapter): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      await supabase.from('semesters').update({ status: 'CLOSED', updated_at: now }).eq('status', 'ACTIVE');
      const { error } = await supabase.from('semesters').update({ status: 'ACTIVE', updated_at: now }).eq('id', semesterId);
      if (error) {
        throw new Error(`Failed to set active semester in Supabase: ${error.message}`);
      }
    }

    try {
      const db = await this.getDb(adapter);
      await db.transaction(async (tx) => {
        // Set any existing ACTIVE semester to CLOSED
        await tx.execute("UPDATE semesters SET status = 'CLOSED' WHERE status = 'ACTIVE'");
        // Set the target semester to ACTIVE
        await tx.execute("UPDATE semesters SET status = 'ACTIVE' WHERE id = ?", [semesterId]);
      });
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache active semester in SQLite:', err);
    }
  }

  public static async getSemesterStats(
    semesterId: string,
    adapter?: DatabaseAdapter
  ): Promise<{ enrolledCount: number; eventCount: number }> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const [enrolledRes, eventsRes] = await Promise.all([
        supabase.from('student_enrollments').select('*', { count: 'exact', head: true }).eq('semester_id', semesterId),
        supabase.from('events').select('*', { count: 'exact', head: true }).eq('semester_id', semesterId),
      ]);
      return {
        enrolledCount: enrolledRes.count || 0,
        eventCount: eventsRes.count || 0,
      };
    }

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
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return [];
      }
      let query = supabase.from('event_categories').select('*').order('sort_order', { ascending: true });
      if (!includeInactive) query = query.eq('status', 'ACTIVE');
      const { data, error } = await query;
      if (error) throw new Error(`Failed to query event categories from Supabase: ${error.message}`);
      return (data || []) as EventCategory[];
    }
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
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      const { error } = await supabase.from('year_levels').insert({
        id: yl.id,
        level_number: yl.level_number,
        display_name: yl.display_name.trim(),
        status: yl.status || 'ACTIVE',
        sort_order: yl.sort_order || 0,
        created_at: yl.created_at || now,
        updated_at: yl.updated_at || now,
      });
      if (error) {
        throw new Error(`Failed to insert year level into Supabase: ${error.message}`);
      }
    }

    try {
      const db = await this.getDb(adapter);
      await db.execute(
        `INSERT INTO year_levels (id, level_number, display_name, status, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [yl.id, yl.level_number, yl.display_name.trim(), yl.status || 'ACTIVE', yl.sort_order || 0, yl.created_at, yl.updated_at]
      );
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache year level in SQLite:', err);
    }
  }

  public static async updateYearLevel(
    yl: Partial<YearLevel> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      const remoteUpdates: Record<string, unknown> = {
        updated_at: yl.updated_at || now,
      };
      if (yl.display_name !== undefined) remoteUpdates.display_name = yl.display_name.trim();
      if (yl.level_number !== undefined) remoteUpdates.level_number = yl.level_number;
      if (yl.status !== undefined) remoteUpdates.status = yl.status;
      if (yl.sort_order !== undefined) remoteUpdates.sort_order = yl.sort_order;

      const { error } = await supabase.from('year_levels').update(remoteUpdates).eq('id', yl.id);
      if (error) {
        throw new Error(`Failed to update year level in Supabase: ${error.message}`);
      }
    }

    try {
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
      params.push(yl.updated_at || now);

      params.push(yl.id);
      await db.execute(`UPDATE year_levels SET ${updates.join(', ')} WHERE id = ?`, params);
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache year level update in SQLite:', err);
    }
  }

  public static async getYearLevels(includeInactive = false, adapter?: DatabaseAdapter): Promise<YearLevel[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return [];
      }
      let query = supabase.from('year_levels').select('*').order('level_number', { ascending: true });
      if (!includeInactive) query = query.eq('status', 'ACTIVE');
      const { data, error } = await query;
      if (error) throw new Error(`Failed to query year levels from Supabase: ${error.message}`);
      return (data || []) as YearLevel[];
    }
    const db = await this.getDb(adapter);
    const sql = includeInactive
      ? 'SELECT * FROM year_levels ORDER BY sort_order ASC, level_number ASC'
      : "SELECT * FROM year_levels WHERE status = 'ACTIVE' ORDER BY sort_order ASC, level_number ASC";
    return db.query<YearLevel>(sql);
  }

  public static async getYearLevelById(id: string, adapter?: DatabaseAdapter): Promise<YearLevel | null> {
    if (!id) return null;
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase.from('year_levels').select('*').eq('id', id).maybeSingle();
      if (error || !data) return null;
      return data as YearLevel;
    }
    const db = await this.getDb(adapter);
    return db.queryOne<YearLevel>('SELECT * FROM year_levels WHERE id = ?', [id]);
  }

  public static async getYearLevelByNumber(num: number, adapter?: DatabaseAdapter): Promise<YearLevel | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase.from('year_levels').select('*').eq('level_number', num).maybeSingle();
      if (error || !data) return null;
      return data as YearLevel;
    }
    const db = await this.getDb(adapter);
    return db.queryOne<YearLevel>('SELECT * FROM year_levels WHERE level_number = ? LIMIT 1', [num]);
  }

  // ============================================================================
  // 5. SECTIONS (One Year Level -> Many Sections)
  // ============================================================================

  public static async createSection(sec: SectionRecord, adapter?: DatabaseAdapter): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      const { error } = await supabase.from('sections').insert({
        id: sec.id,
        section_name: sec.section_name.trim(),
        year_level_id: sec.year_level_id,
        program_id: sec.program_id || null,
        academic_year_id: sec.academic_year_id || null,
        status: sec.status || 'ACTIVE',
        created_at: sec.created_at || now,
        updated_at: sec.updated_at || now,
      });
      if (error) {
        throw new Error(`Failed to insert section into Supabase: ${error.message}`);
      }
    }

    try {
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
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache section in SQLite:', err);
    }
  }

  public static async updateSection(
    sec: Partial<SectionRecord> & { id: string },
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      const remoteUpdates: Record<string, unknown> = {
        updated_at: sec.updated_at || now,
      };
      if (sec.section_name !== undefined) remoteUpdates.section_name = sec.section_name.trim();
      if (sec.year_level_id !== undefined) remoteUpdates.year_level_id = sec.year_level_id;
      if (sec.program_id !== undefined) remoteUpdates.program_id = sec.program_id || null;
      if (sec.academic_year_id !== undefined) remoteUpdates.academic_year_id = sec.academic_year_id || null;
      if (sec.status !== undefined) remoteUpdates.status = sec.status;

      const { error } = await supabase.from('sections').update(remoteUpdates).eq('id', sec.id);
      if (error) {
        throw new Error(`Failed to update section in Supabase: ${error.message}`);
      }
    }

    try {
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
      params.push(sec.updated_at || now);

      params.push(sec.id);
      await db.execute(`UPDATE sections SET ${updates.join(', ')} WHERE id = ?`, params);
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache section update in SQLite:', err);
    }
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
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return [];
      }
      let query = supabase.from('sections').select('*, year_level:year_levels(display_name), program:programs(code)').order('section_name', { ascending: true });
      if (!filters?.includeInactive) query = query.eq('status', 'ACTIVE');
      if (filters?.yearLevelId) query = query.eq('year_level_id', filters.yearLevelId);
      if (filters?.programId) query = query.eq('program_id', filters.programId);
      const { data, error } = await query;
      if (error) throw new Error(`Failed to query sections from Supabase: ${error.message}`);
      return (data || []).map((row: any) => ({
        ...row,
        year_display: row.year_level?.display_name || undefined,
        program_code: row.program?.code || undefined,
      }));
    }
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
    if (!id) return null;
    if (DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase.from('sections').select('*').eq('id', id).maybeSingle();
      if (error || !data) return null;
      return data as SectionRecord;
    }
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
    if (DataModeService.isDirectSupabase()) {
      let query = supabase.from('sections').select('*').ilike('section_name', name.trim());
      if (yearLevelId) query = query.eq('year_level_id', yearLevelId);
      if (programId) query = query.eq('program_id', programId);
      const { data, error } = await query.limit(1);
      if (error || !data || data.length === 0) return null;
      return data[0] as SectionRecord;
    }
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
    const isAct = program.status ? (program.status === 'ACTIVE' ? 1 : 0) : (program.is_active ?? 1);
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO programs (id, code, name, is_active)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, is_active=excluded.is_active`,
      [program.id, program.code.trim().toUpperCase(), program.name.trim(), isAct]
    );
  }

  public static async createProgram(program: Program, adapter?: DatabaseAdapter): Promise<void> {
    const isAct = program.status ? (program.status === 'ACTIVE' ? 1 : 0) : (program.is_active ?? 1);
    const stat = program.status || (isAct === 1 ? 'ACTIVE' : 'INACTIVE');
    const now = new Date().toISOString();

    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      const { error } = await supabase.from('programs').insert({
        id: program.id,
        code: program.code.trim().toUpperCase(),
        name: program.name.trim(),
        status: stat,
        created_at: program.created_at || now,
        updated_at: program.updated_at || now,
      });
      if (error) {
        throw new Error(`Failed to insert program into Supabase: ${error.message}`);
      }
    }

    try {
      const db = await this.getDb(adapter);
      await db.execute(
        `INSERT INTO programs (id, code, name, is_active)
         VALUES (?, ?, ?, ?)`,
        [program.id, program.code.trim().toUpperCase(), program.name.trim(), isAct]
      );
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to cache program in SQLite:', err);
    }
  }

  public static async updateProgram(
    id: string,
    updates: Partial<Program>,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    const now = new Date().toISOString();
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      const remoteUpdates: Record<string, unknown> = {
        updated_at: updates.updated_at || now,
      };
      if (updates.code !== undefined) remoteUpdates.code = updates.code.trim().toUpperCase();
      if (updates.name !== undefined) remoteUpdates.name = updates.name.trim();
      if (updates.status !== undefined) {
        remoteUpdates.status = updates.status;
      } else if (updates.is_active !== undefined) {
        remoteUpdates.status = updates.is_active === 1 ? 'ACTIVE' : 'INACTIVE';
      }
      const { error } = await supabase.from('programs').update(remoteUpdates).eq('id', id);
      if (error) {
        throw new Error(`Failed to update program in Supabase: ${error.message}`);
      }
    }

    try {
      const db = await this.getDb(adapter);
      const sqlUpdates: string[] = [];
      const params: unknown[] = [];
      if (updates.code !== undefined) {
        sqlUpdates.push('code = ?');
        params.push(updates.code.trim().toUpperCase());
      }
      if (updates.name !== undefined) {
        sqlUpdates.push('name = ?');
        params.push(updates.name.trim());
      }
      if (updates.status !== undefined) {
        sqlUpdates.push('is_active = ?');
        params.push(updates.status === 'ACTIVE' ? 1 : 0);
      } else if (updates.is_active !== undefined) {
        sqlUpdates.push('is_active = ?');
        params.push(updates.is_active);
      }
      if (sqlUpdates.length > 0) {
        params.push(id);
        await db.execute(`UPDATE programs SET ${sqlUpdates.join(', ')} WHERE id = ?`, params);
      }
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to update program in SQLite:', err);
    }
  }

  public static async getPrograms(
    includeInactiveOrAdapter?: boolean | DatabaseAdapter,
    adapter?: DatabaseAdapter
  ): Promise<Program[]> {
    let includeInactive = false;
    let actualAdapter = adapter;
    if (typeof includeInactiveOrAdapter === 'boolean') {
      includeInactive = includeInactiveOrAdapter;
    } else if (includeInactiveOrAdapter !== undefined) {
      actualAdapter = includeInactiveOrAdapter;
    }

    if (!actualAdapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(actualAdapter))) {
        return [];
      }
      let query = supabase
        .from('programs')
        .select('*')
        .order('code', { ascending: true });
      if (!includeInactive) {
        query = query.eq('status', 'ACTIVE');
      }
      const { data, error } = await query;
      if (error) {
        console.warn('[AcademicRepository] Failed to fetch programs from Supabase:', error.message);
        return [];
      }
      return (data || []).map((p: any) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        is_active: p.status === 'ACTIVE' || p.is_active === 1 || p.is_active === true ? 1 : 0,
        status: (p.status || (p.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) as 'ACTIVE' | 'INACTIVE',
        created_at: p.created_at,
        updated_at: p.updated_at,
      }));
    }
    const db = await this.getDb(actualAdapter);
    const sql = includeInactive
      ? 'SELECT * FROM programs ORDER BY code ASC'
      : 'SELECT * FROM programs WHERE is_active = 1 ORDER BY code ASC';
    const rows = await db.query<Program>(sql);
    return rows.map((r) => ({
      ...r,
      status: (r.is_active === 1 ? 'ACTIVE' : 'INACTIVE') as 'ACTIVE' | 'INACTIVE',
    }));
  }

  public static async getProgramById(id: string, adapter?: DatabaseAdapter): Promise<Program | null> {
    if (!id) return null;
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase
        .from('programs')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        code: data.code,
        name: data.name,
        is_active: data.status === 'ACTIVE' || data.is_active === 1 || data.is_active === true ? 1 : 0,
        status: (data.status || (data.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) as 'ACTIVE' | 'INACTIVE',
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    }
    const db = await this.getDb(adapter);
    const row = await db.queryOne<Program>('SELECT * FROM programs WHERE id = ?', [id]);
    if (!row) return null;
    return {
      ...row,
      status: (row.is_active === 1 ? 'ACTIVE' : 'INACTIVE') as 'ACTIVE' | 'INACTIVE',
    };
  }

  public static async getProgramByCode(code: string, adapter?: DatabaseAdapter): Promise<Program | null> {
    if (!code) return null;
    const cleanCode = code.trim().toUpperCase();
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return null;
      }
      const { data, error } = await supabase
        .from('programs')
        .select('*')
        .ilike('code', cleanCode)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        code: data.code,
        name: data.name,
        is_active: data.status === 'ACTIVE' || data.is_active === 1 || data.is_active === true ? 1 : 0,
        status: (data.status || (data.is_active === 1 ? 'ACTIVE' : 'INACTIVE')) as 'ACTIVE' | 'INACTIVE',
        created_at: data.created_at,
        updated_at: data.updated_at,
      };
    }
    const db = await this.getDb(adapter);
    const row = await db.queryOne<Program>('SELECT * FROM programs WHERE UPPER(code) = ?', [cleanCode]);
    if (!row) return null;
    return {
      ...row,
      status: (row.is_active === 1 ? 'ACTIVE' : 'INACTIVE') as 'ACTIVE' | 'INACTIVE',
    };
  }

  public static async deleteProgram(id: string, adapter?: DatabaseAdapter): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        throw new Error('Authentication required: Direct Supabase Mode requires an authenticated DevAdmin session.');
      }
      const { error } = await supabase.from('programs').delete().eq('id', id);
      if (error) {
        throw new Error(`Failed to delete program from Supabase: ${error.message}`);
      }
    }
    try {
      const db = await this.getDb(adapter);
      await db.execute('DELETE FROM programs WHERE id = ?', [id]);
    } catch (err) {
      if (!DataModeService.isDirectSupabase()) {
        throw err;
      }
      console.warn('[AcademicRepository] Failed to delete program from SQLite:', err);
    }
  }

  public static async getProgramSectionCount(id: string, adapter?: DatabaseAdapter): Promise<number> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return 0;
      }
      const { count, error } = await supabase
        .from('sections')
        .select('*', { count: 'exact', head: true })
        .eq('program_id', id);
      if (!error && count !== null) return count;
    }
    const db = await this.getDb(adapter);
    const row = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM sections WHERE program_id = ?', [id]);
    return row?.count || 0;
  }

  public static async getProgramEnrollmentCount(id: string, adapter?: DatabaseAdapter): Promise<number> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      if (!(await this.isDirectSupabaseAllowed(adapter))) {
        return 0;
      }
      const { count, error } = await supabase
        .from('student_enrollments')
        .select('*', { count: 'exact', head: true })
        .eq('program_id', id);
      if (!error && count !== null) return count;
    }
    const db = await this.getDb(adapter);
    const row = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM student_enrollments WHERE program_id = ?', [id]);
    return row?.count || 0;
  }

  // ============================================================================
  // 7. ENROLLMENTS
  // ============================================================================

  public static async createEnrollment(enrollment: StudentEnrollment, adapter?: DatabaseAdapter): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('student_enrollments').upsert({
        id: enrollment.id,
        student_id: enrollment.student_id,
        semester_id: enrollment.semester_id,
        program_id: enrollment.program_id || null,
        year_level: enrollment.year_level,
        section: enrollment.section,
        year_level_id: enrollment.year_level_id || null,
        section_id: enrollment.section_id || null,
        enrollment_status: enrollment.enrollment_status,
        first_name_snapshot: enrollment.first_name_snapshot,
        middle_name_snapshot: enrollment.middle_name_snapshot || null,
        last_name_snapshot: enrollment.last_name_snapshot,
        updated_at: enrollment.updated_at || new Date().toISOString(),
      });
      if (error) {
        throw new Error(`Failed to upsert enrollment into Supabase: ${error.message}`);
      }
      return;
    }

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
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('student_id', studentId)
        .order('updated_at', { ascending: false });
      if (error) throw new Error(`Failed to query enrollments from Supabase: ${error.message}`);
      return (data || []) as StudentEnrollment[];
    }

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
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('student_enrollments')
        .select('*')
        .eq('student_id', studentId)
        .eq('semester_id', semesterId)
        .maybeSingle();
      if (error) throw new Error(`Failed to query student enrollment from Supabase: ${error.message}`);
      return (data || null) as StudentEnrollment | null;
    }

    const db = await this.getDb(adapter);
    return db.queryOne<StudentEnrollment>(
      'SELECT * FROM student_enrollments WHERE student_id = ? AND semester_id = ?',
      [studentId, semesterId]
    );
  }
}
