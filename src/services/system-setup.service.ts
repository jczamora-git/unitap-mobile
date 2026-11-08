import { AcademicRepository } from '@/database/repositories/academic.repository';
import { authService } from './auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '@/database/database';
import { OperationPolicyService } from './operation-policy.service';
import { DataModeService } from './data-mode.service';
import type {
  EventCategory,
  YearLevel,
  SectionRecord,
  AcademicYear,
  Semester,
  Program,
} from '@/types/database';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class SystemSetupService {
  /**
   * Enforces that current session has DEVADMIN authorization and online policy is satisfied.
   */
  public static async verifyDevAdmin(): Promise<void> {
    await OperationPolicyService.assertPermitted('ACADEMIC_SYSTEM_SETUP_MUTATIONS');

    if (DataModeService.isDirectSupabase()) {
      const hasCloudSession = await SupabaseAuthService.hasValidCloudSession();
      const remoteRole = SupabaseAuthService.role.value;
      if (!hasCloudSession || remoteRole !== 'DEVADMIN') {
        throw new Error('Unauthorized: Direct Supabase Mode requires an authenticated Supabase Auth DevAdmin session. Please sign in with your cloud administrator credentials.');
      }
      return;
    }

    const localRole = authService.role.value;
    const remoteRole = SupabaseAuthService.role.value;
    if (localRole !== 'DEVADMIN' && remoteRole !== 'DEVADMIN') {
      throw new Error('Unauthorized: Only DevAdmin accounts are permitted to configure system setup.');
    }
  }

  /**
   * Helper to queue outbox operation if offline
   */
  private static async enqueueOutbox(
    entityType: string,
    entityId: string,
    operation: 'CREATE' | 'UPDATE' | 'DELETE',
    payload: Record<string, unknown>
  ): Promise<void> {
    if (DataModeService.isDirectSupabase()) {
      return;
    }
    try {
      const db = await getDatabase();
      const outboxId = 'out_' + Math.random().toString(36).substring(2, 10);
      const now = new Date().toISOString();
      await db.execute(
        `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
         VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
        [now]
      );
      const op = operation === 'DELETE' ? 'VOID' : operation;
      await db.execute(
        `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at)
         VALUES (?, 'dev_default', ?, ?, ?, ?, 1, ?)`,
        [outboxId, entityType, entityId, op, JSON.stringify(payload), now]
      );
    } catch (err) {
      console.warn('[SystemSetupService] Failed to queue outbox record:', err);
    }
  }

  // ============================================================================
  // 1. EVENT CATEGORIES
  // ============================================================================

  public static async getEventCategories(includeInactive = false): Promise<EventCategory[]> {
    return AcademicRepository.getEventCategories(includeInactive);
  }

  public static async getEventCategoryById(id: string): Promise<EventCategory | null> {
    return AcademicRepository.getEventCategoryById(id);
  }

  public static async createEventCategory(dto: {
    name: string;
    description?: string;
    code?: string;
    sortOrder?: number;
  }): Promise<EventCategory> {
    await this.verifyDevAdmin();
    const cleanName = dto.name.trim();
    if (!cleanName) {
      throw new Error('Event category name is required.');
    }

    const existing = await AcademicRepository.getEventCategoryByName(cleanName);
    if (existing) {
      throw new Error(`An event category named "${cleanName}" already exists.`);
    }

    const code = (dto.code?.trim() || cleanName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()).substring(0, 30);
    const now = new Date().toISOString();

    const actorId = authService.user.value?.id || SupabaseAuthService.user.value?.id || null;
    let validUserId: string | null = null;
    if (actorId) {
      try {
        const db = await getDatabase();
        const userExists = await db.queryOne<{ id: string }>('SELECT id FROM users WHERE id = ?', [actorId]);
        if (userExists) validUserId = actorId;
      } catch {
        // Ignored
      }
    }

    const newCategory: EventCategory = {
      id: generateUuid(),
      name: cleanName,
      description: dto.description?.trim() || null,
      code,
      status: 'ACTIVE',
      sort_order: dto.sortOrder ?? 0,
      created_by_user_id: validUserId,
      created_at: now,
      updated_at: now,
    };

    // 1. Write to local database
    await AcademicRepository.createEventCategory(newCategory);

    // 2. Sync to Supabase if connected
    try {
      const { error } = await supabase.from('event_categories').insert(newCategory);
      if (error) {
        await this.enqueueOutbox('EVENT_CATEGORY', newCategory.id, 'CREATE', newCategory as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('EVENT_CATEGORY', newCategory.id, 'CREATE', newCategory as unknown as Record<string, unknown>);
    }

    return newCategory;
  }

  public static async updateEventCategory(
    id: string,
    dto: {
      name?: string;
      description?: string;
      code?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      sortOrder?: number;
    }
  ): Promise<EventCategory> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getEventCategoryById(id);
    if (!existing) {
      throw new Error('Event category not found.');
    }

    if (dto.name && dto.name.trim().toLowerCase() !== existing.name.toLowerCase()) {
      const conflict = await AcademicRepository.getEventCategoryByName(dto.name.trim());
      if (conflict && conflict.id !== id) {
        throw new Error(`An event category named "${dto.name.trim()}" already exists.`);
      }
    }

    const now = new Date().toISOString();
    const updates: Partial<EventCategory> & { id: string } = {
      id,
      name: dto.name !== undefined ? dto.name.trim() : existing.name,
      description: dto.description !== undefined ? (dto.description.trim() || null) : existing.description,
      code: dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code,
      status: dto.status !== undefined ? dto.status : existing.status,
      sort_order: dto.sortOrder !== undefined ? dto.sortOrder : existing.sort_order,
      updated_at: now,
    };

    await AcademicRepository.updateEventCategory(updates);

    try {
      const { error } = await supabase.from('event_categories').update(updates).eq('id', id);
      if (error) {
        await this.enqueueOutbox('EVENT_CATEGORY', id, 'UPDATE', updates as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('EVENT_CATEGORY', id, 'UPDATE', updates as unknown as Record<string, unknown>);
    }

    return (await AcademicRepository.getEventCategoryById(id))!;
  }

  public static async toggleCategoryStatus(id: string): Promise<EventCategory> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getEventCategoryById(id);
    if (!existing) {
      throw new Error('Event category not found.');
    }
    const newStatus = existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    return this.updateEventCategory(id, { status: newStatus });
  }

  public static async getCategoryUsageCount(id: string): Promise<number> {
    return AcademicRepository.getEventCategoryUsageCount(id);
  }

  public static async deleteCategory(id: string): Promise<void> {
    await this.verifyDevAdmin();
    const usage = await this.getCategoryUsageCount(id);
    if (usage > 0) {
      throw new Error(`Cannot delete category because it is referenced by ${usage} event(s). Please deactivate it instead.`);
    }
    const db = await getDatabase();
    await db.execute('DELETE FROM event_categories WHERE id = ?', [id]);
    try {
      await supabase.from('event_categories').delete().eq('id', id);
    } catch {
      await this.enqueueOutbox('EVENT_CATEGORY', id, 'DELETE', { id });
    }
  }

  // ============================================================================
  // 2. YEAR LEVELS
  // ============================================================================

  public static async getYearLevels(includeInactive = false): Promise<YearLevel[]> {
    return AcademicRepository.getYearLevels(includeInactive);
  }

  public static async getYearLevelById(id: string): Promise<YearLevel | null> {
    return AcademicRepository.getYearLevelById(id);
  }

  public static async createYearLevel(dto: {
    levelNumber: number;
    displayName: string;
    sortOrder?: number;
  }): Promise<YearLevel> {
    await this.verifyDevAdmin();
    if (!dto.levelNumber || dto.levelNumber < 1) {
      throw new Error('A valid positive year level number is required.');
    }
    const cleanDisplay = dto.displayName.trim();
    if (!cleanDisplay) {
      throw new Error('Display name is required (e.g. "5th Year").');
    }

    const existing = await AcademicRepository.getYearLevelByNumber(dto.levelNumber);
    if (existing) {
      throw new Error(`Year level number ${dto.levelNumber} already exists (${existing.display_name}).`);
    }

    const now = new Date().toISOString();
    const newLevel: YearLevel = {
      id: generateUuid(),
      level_number: dto.levelNumber,
      display_name: cleanDisplay,
      status: 'ACTIVE',
      sort_order: dto.sortOrder ?? dto.levelNumber,
      created_at: now,
      updated_at: now,
    };

    await AcademicRepository.createYearLevel(newLevel);

    try {
      const { error } = await supabase.from('year_levels').insert(newLevel);
      if (error) {
        await this.enqueueOutbox('YEAR_LEVEL', newLevel.id, 'CREATE', newLevel as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('YEAR_LEVEL', newLevel.id, 'CREATE', newLevel as unknown as Record<string, unknown>);
    }

    return newLevel;
  }

  public static async updateYearLevel(
    id: string,
    dto: {
      displayName?: string;
      status?: 'ACTIVE' | 'INACTIVE';
      sortOrder?: number;
    }
  ): Promise<YearLevel> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getYearLevelById(id);
    if (!existing) {
      throw new Error('Year level not found.');
    }

    const now = new Date().toISOString();
    const updates: Partial<YearLevel> & { id: string } = {
      id,
      display_name: dto.displayName !== undefined ? dto.displayName.trim() : existing.display_name,
      status: dto.status !== undefined ? dto.status : existing.status,
      sort_order: dto.sortOrder !== undefined ? dto.sortOrder : existing.sort_order,
      updated_at: now,
    };

    await AcademicRepository.updateYearLevel(updates);

    try {
      const { error } = await supabase.from('year_levels').update(updates).eq('id', id);
      if (error) {
        await this.enqueueOutbox('YEAR_LEVEL', id, 'UPDATE', updates as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('YEAR_LEVEL', id, 'UPDATE', updates as unknown as Record<string, unknown>);
    }

    return (await AcademicRepository.getYearLevelById(id))!;
  }

  public static async toggleYearLevelStatus(id: string): Promise<YearLevel> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getYearLevelById(id);
    if (!existing) throw new Error('Year level not found.');
    return this.updateYearLevel(id, { status: existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
  }

  // ============================================================================
  // 3. SECTIONS (One Year Level -> Many Sections)
  // ============================================================================

  public static async getSections(filters?: {
    yearLevelId?: string;
    programId?: string;
    academicYearId?: string;
    includeInactive?: boolean;
  }): Promise<(SectionRecord & { year_display?: string; program_code?: string })[]> {
    return AcademicRepository.getSections(filters);
  }

  public static async getSectionById(id: string): Promise<SectionRecord | null> {
    return AcademicRepository.getSectionById(id);
  }

  public static async createSection(dto: {
    sectionName: string;
    yearLevelId: string;
    programId?: string | null;
    academicYearId?: string | null;
  }): Promise<SectionRecord> {
    await this.verifyDevAdmin();
    const cleanName = dto.sectionName.trim().toUpperCase();
    if (!cleanName) {
      throw new Error('Section name is required (e.g. "4F4").');
    }
    if (!dto.yearLevelId) {
      throw new Error('Year level assignment is required.');
    }

    // Verify year level exists
    const yl = await AcademicRepository.getYearLevelById(dto.yearLevelId);
    if (!yl) {
      throw new Error('Assigned year level does not exist.');
    }

    // Check unique section within scope
    const existing = await AcademicRepository.getSectionByName(
      cleanName,
      dto.yearLevelId,
      dto.academicYearId || undefined,
      dto.programId || undefined
    );
    if (existing) {
      throw new Error(`Section "${cleanName}" already exists for this year level and academic context.`);
    }

    const now = new Date().toISOString();
    const newSection: SectionRecord = {
      id: generateUuid(),
      section_name: cleanName,
      year_level_id: dto.yearLevelId,
      program_id: dto.programId || null,
      academic_year_id: dto.academicYearId || null,
      status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };

    await AcademicRepository.createSection(newSection);

    try {
      const { error } = await supabase.from('sections').insert(newSection);
      if (error) {
        await this.enqueueOutbox('SECTION', newSection.id, 'CREATE', newSection as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('SECTION', newSection.id, 'CREATE', newSection as unknown as Record<string, unknown>);
    }

    return newSection;
  }

  public static async updateSection(
    id: string,
    dto: {
      sectionName?: string;
      yearLevelId?: string;
      programId?: string | null;
      academicYearId?: string | null;
      status?: 'ACTIVE' | 'INACTIVE';
    }
  ): Promise<SectionRecord> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getSectionById(id);
    if (!existing) {
      throw new Error('Section not found.');
    }

    const cleanName = dto.sectionName !== undefined ? dto.sectionName.trim().toUpperCase() : existing.section_name;
    const targetYlId = dto.yearLevelId !== undefined ? dto.yearLevelId : existing.year_level_id;
    const targetAyId = dto.academicYearId !== undefined ? dto.academicYearId : existing.academic_year_id;
    const targetProgId = dto.programId !== undefined ? dto.programId : existing.program_id;

    if (cleanName !== existing.section_name || targetYlId !== existing.year_level_id) {
      const conflict = await AcademicRepository.getSectionByName(
        cleanName,
        targetYlId,
        targetAyId || undefined,
        targetProgId || undefined
      );
      if (conflict && conflict.id !== id) {
        throw new Error(`Section "${cleanName}" already exists in this scope.`);
      }
    }

    const now = new Date().toISOString();
    const updates: Partial<SectionRecord> & { id: string } = {
      id,
      section_name: cleanName,
      year_level_id: targetYlId,
      program_id: targetProgId,
      academic_year_id: targetAyId,
      status: dto.status !== undefined ? dto.status : existing.status,
      updated_at: now,
    };

    await AcademicRepository.updateSection(updates);

    try {
      const { error } = await supabase.from('sections').update(updates).eq('id', id);
      if (error) {
        await this.enqueueOutbox('SECTION', id, 'UPDATE', updates as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('SECTION', id, 'UPDATE', updates as unknown as Record<string, unknown>);
    }

    return (await AcademicRepository.getSectionById(id))!;
  }

  public static async toggleSectionStatus(id: string): Promise<SectionRecord> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getSectionById(id);
    if (!existing) throw new Error('Section not found.');
    return this.updateSection(id, { status: existing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' });
  }

  public static async getSectionEnrollmentCount(id: string): Promise<number> {
    return AcademicRepository.getSectionEnrollmentCount(id);
  }

  public static async deleteSection(id: string): Promise<void> {
    await this.verifyDevAdmin();
    const count = await this.getSectionEnrollmentCount(id);
    if (count > 0) {
      throw new Error(`Cannot delete section because it has ${count} student enrollment record(s). Deactivate it instead.`);
    }
    const db = await getDatabase();
    await db.execute('DELETE FROM sections WHERE id = ?', [id]);
    try {
      await supabase.from('sections').delete().eq('id', id);
    } catch {
      await this.enqueueOutbox('SECTION', id, 'DELETE', { id });
    }
  }

  // ============================================================================
  // 4. ACADEMIC YEARS
  // ============================================================================

  public static async getAcademicYears(): Promise<AcademicYear[]> {
    return AcademicRepository.getYears();
  }

  public static async getAcademicYearById(id: string): Promise<AcademicYear | null> {
    return AcademicRepository.getYearById(id);
  }

  public static async createAcademicYear(dto: {
    label: string;
    startsOn: string;
    endsOn: string;
    status?: AcademicYear['status'];
  }): Promise<AcademicYear> {
    await this.verifyDevAdmin();
    const cleanLabel = dto.label.trim();
    if (!cleanLabel) {
      throw new Error('Academic year label is required (e.g. "2026-2027").');
    }
    if (!dto.startsOn || !dto.endsOn) {
      throw new Error('Start and end dates are required.');
    }
    if (dto.startsOn >= dto.endsOn) {
      throw new Error('Academic year start date must precede end date.');
    }

    const existing = await AcademicRepository.getYearByLabel(cleanLabel);
    if (existing) {
      throw new Error(`Academic year "${cleanLabel}" already exists.`);
    }

    const newYear: AcademicYear = {
      id: generateUuid(),
      label: cleanLabel,
      starts_on: dto.startsOn,
      ends_on: dto.endsOn,
      status: dto.status || 'PLANNED',
    };

    await AcademicRepository.createYear(newYear);

    try {
      const { error } = await supabase.from('academic_years').insert(newYear);
      if (error) {
        await this.enqueueOutbox('ACADEMIC_YEAR', newYear.id, 'CREATE', newYear as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('ACADEMIC_YEAR', newYear.id, 'CREATE', newYear as unknown as Record<string, unknown>);
    }

    return newYear;
  }

  public static async updateAcademicYear(
    id: string,
    dto: {
      label?: string;
      startsOn?: string;
      endsOn?: string;
      status?: AcademicYear['status'];
    }
  ): Promise<AcademicYear> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getYearById(id);
    if (!existing) throw new Error('Academic year not found.');

    if (dto.label && dto.label.trim().toLowerCase() !== existing.label.toLowerCase()) {
      const conflict = await AcademicRepository.getYearByLabel(dto.label.trim());
      if (conflict && conflict.id !== id) {
        throw new Error(`Academic year "${dto.label.trim()}" already exists.`);
      }
    }

    const starts = dto.startsOn || existing.starts_on;
    const ends = dto.endsOn || existing.ends_on;
    if (starts >= ends) {
      throw new Error('Academic year start date must precede end date.');
    }

    const updates: Partial<AcademicYear> & { id: string } = {
      id,
      label: dto.label !== undefined ? dto.label.trim() : existing.label,
      starts_on: starts,
      ends_on: ends,
      status: dto.status !== undefined ? dto.status : existing.status,
    };

    await AcademicRepository.updateYear(updates);

    try {
      const { error } = await supabase.from('academic_years').update(updates).eq('id', id);
      if (error) {
        await this.enqueueOutbox('ACADEMIC_YEAR', id, 'UPDATE', updates as unknown as Record<string, unknown>);
      }
    } catch {
      await this.enqueueOutbox('ACADEMIC_YEAR', id, 'UPDATE', updates as unknown as Record<string, unknown>);
    }

    return (await AcademicRepository.getYearById(id))!;
  }

  public static async setAcademicYearStatus(id: string, status: AcademicYear['status']): Promise<void> {
    await this.verifyDevAdmin();
    await AcademicRepository.setYearStatus(id, status);
    try {
      await supabase.from('academic_years').update({ status }).eq('id', id);
    } catch {
      await this.enqueueOutbox('ACADEMIC_YEAR', id, 'UPDATE', { id, status });
    }
  }

  // ============================================================================
  // 5. SEMESTERS
  // ============================================================================

  public static async getSemesters(academicYearId?: string): Promise<Semester[]> {
    if (academicYearId) {
      return AcademicRepository.getSemestersByYear(academicYearId);
    }
    return AcademicRepository.getSemesters();
  }

  public static async getActiveSemester(): Promise<Semester | null> {
    return AcademicRepository.getActiveSemester();
  }

  public static async getSemesterById(id: string): Promise<Semester | null> {
    return AcademicRepository.getSemesterById(id);
  }

  public static async createSemester(dto: {
    academicYearId: string;
    term: 'FIRST' | 'SECOND' | 'SUMMER';
    startsOn: string;
    endsOn: string;
    status?: Semester['status'];
  }): Promise<Semester> {
    await this.verifyDevAdmin();
    if (!dto.academicYearId) {
      throw new Error('Academic year assignment is required.');
    }
    if (!dto.startsOn || !dto.endsOn) {
      throw new Error('Start and end dates are required.');
    }
    if (dto.startsOn >= dto.endsOn) {
      throw new Error('Semester start date must precede end date.');
    }

    // Verify parent academic year exists
    const ay = await AcademicRepository.getYearById(dto.academicYearId);
    if (!ay) {
      throw new Error('Target academic year does not exist.');
    }

    // Prevent duplicate term in same academic year
    const existingInYear = await AcademicRepository.getSemestersByYear(dto.academicYearId);
    const duplicate = existingInYear.find((s) => s.term === dto.term);
    if (duplicate) {
      throw new Error(`The ${dto.term} semester is already registered for academic year ${ay.label}.`);
    }

    const newSemester: Semester = {
      id: generateUuid(),
      academic_year_id: dto.academicYearId,
      term: dto.term,
      starts_on: dto.startsOn,
      ends_on: dto.endsOn,
      status: dto.status || 'PLANNED',
    };

    await AcademicRepository.createSemester(newSemester);

    if (!DataModeService.isDirectSupabase()) {
      try {
        const { error } = await supabase.from('semesters').insert(newSemester);
        if (error) {
          await this.enqueueOutbox('SEMESTER', newSemester.id, 'CREATE', newSemester as unknown as Record<string, unknown>);
        }
      } catch {
        await this.enqueueOutbox('SEMESTER', newSemester.id, 'CREATE', newSemester as unknown as Record<string, unknown>);
      }
    }

    return newSemester;
  }

  public static async updateSemester(
    id: string,
    dto: {
      term?: 'FIRST' | 'SECOND' | 'SUMMER';
      startsOn?: string;
      endsOn?: string;
      status?: Semester['status'];
    }
  ): Promise<Semester> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getSemesterById(id);
    if (!existing) throw new Error('Semester not found.');

    const starts = dto.startsOn || existing.starts_on;
    const ends = dto.endsOn || existing.ends_on;
    if (starts >= ends) {
      throw new Error('Semester start date must precede end date.');
    }

    const updates: Partial<Semester> & { id: string } = {
      id,
      term: dto.term || existing.term,
      starts_on: starts,
      ends_on: ends,
      status: dto.status || existing.status,
    };

    await AcademicRepository.updateSemester(updates);

    if (!DataModeService.isDirectSupabase()) {
      try {
        const { error } = await supabase.from('semesters').update(updates).eq('id', id);
        if (error) {
          await this.enqueueOutbox('SEMESTER', id, 'UPDATE', updates as unknown as Record<string, unknown>);
        }
      } catch {
        await this.enqueueOutbox('SEMESTER', id, 'UPDATE', updates as unknown as Record<string, unknown>);
      }
    }

    return (await AcademicRepository.getSemesterById(id))!;
  }

  public static async activateSemester(semesterId: string): Promise<void> {
    await this.verifyDevAdmin();
    const sem = await AcademicRepository.getSemesterById(semesterId);
    if (!sem) throw new Error('Semester not found.');

    // 1. Transactionally activate target and close previous active
    await AcademicRepository.setActiveSemester(semesterId);

    // 2. Also ensure parent academic year is ACTIVE
    await AcademicRepository.setYearStatus(sem.academic_year_id, 'ACTIVE');

    // 3. Mirror in Supabase & outbox if not direct Supabase mode
    if (!DataModeService.isDirectSupabase()) {
      try {
        await supabase.from('semesters').update({ status: 'CLOSED' }).eq('status', 'ACTIVE');
        await supabase.from('semesters').update({ status: 'ACTIVE' }).eq('id', semesterId);
        await supabase.from('academic_years').update({ status: 'ACTIVE' }).eq('id', sem.academic_year_id);
      } catch {
        await this.enqueueOutbox('SEMESTER', semesterId, 'UPDATE', { id: semesterId, status: 'ACTIVE' });
      }
    }
  }

  public static async getSemesterStats(id: string): Promise<{ enrolledCount: number; eventCount: number }> {
    return AcademicRepository.getSemesterStats(id);
  }

  // ============================================================================
  // 6. PROGRAMS
  // ============================================================================

  public static async getPrograms(includeInactive = false): Promise<Program[]> {
    return AcademicRepository.getPrograms(includeInactive);
  }

  public static async getProgramById(id: string): Promise<Program | null> {
    return AcademicRepository.getProgramById(id);
  }

  public static async getProgramByCode(code: string): Promise<Program | null> {
    return AcademicRepository.getProgramByCode(code);
  }

  public static async getProgramSectionCount(id: string): Promise<number> {
    return AcademicRepository.getProgramSectionCount(id);
  }

  public static async getProgramEnrollmentCount(id: string): Promise<number> {
    return AcademicRepository.getProgramEnrollmentCount(id);
  }

  public static async createProgram(dto: {
    code: string;
    name: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }): Promise<Program> {
    await this.verifyDevAdmin();
    const cleanCode = dto.code.trim().toUpperCase();
    const cleanName = dto.name.trim();

    if (!cleanCode) {
      throw new Error('Program code is required (e.g. "BSIT", "BSCS").');
    }
    if (!cleanName) {
      throw new Error('Program name is required.');
    }

    const existing = await AcademicRepository.getProgramByCode(cleanCode);
    if (existing) {
      throw new Error(`A program with code "${cleanCode}" already exists.`);
    }

    const now = new Date().toISOString();
    const status = dto.status || 'ACTIVE';
    const newProgram: Program = {
      id: generateUuid(),
      code: cleanCode,
      name: cleanName,
      status,
      is_active: status === 'ACTIVE' ? 1 : 0,
      created_at: now,
      updated_at: now,
    };

    await AcademicRepository.createProgram(newProgram);

    if (!DataModeService.isDirectSupabase()) {
      try {
        const { error } = await supabase.from('programs').insert({
          id: newProgram.id,
          code: newProgram.code,
          name: newProgram.name,
          status: newProgram.status,
          created_at: newProgram.created_at,
          updated_at: newProgram.updated_at,
        });
        if (error) {
          await this.enqueueOutbox('PROGRAM', newProgram.id, 'CREATE', newProgram as unknown as Record<string, unknown>);
        }
      } catch {
        await this.enqueueOutbox('PROGRAM', newProgram.id, 'CREATE', newProgram as unknown as Record<string, unknown>);
      }
    }

    return newProgram;
  }

  public static async updateProgram(
    id: string,
    dto: {
      code?: string;
      name?: string;
      status?: 'ACTIVE' | 'INACTIVE';
    }
  ): Promise<Program> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getProgramById(id);
    if (!existing) {
      throw new Error('Program not found.');
    }

    const cleanCode = dto.code !== undefined ? dto.code.trim().toUpperCase() : existing.code;
    const cleanName = dto.name !== undefined ? dto.name.trim() : existing.name;

    if (!cleanCode) {
      throw new Error('Program code cannot be empty.');
    }
    if (!cleanName) {
      throw new Error('Program name cannot be empty.');
    }

    if (cleanCode !== existing.code) {
      const conflict = await AcademicRepository.getProgramByCode(cleanCode);
      if (conflict && conflict.id !== id) {
        throw new Error(`A program with code "${cleanCode}" already exists.`);
      }
    }

    const now = new Date().toISOString();
    const status = dto.status !== undefined ? dto.status : (existing.status || (existing.is_active === 1 ? 'ACTIVE' : 'INACTIVE'));

    const updates: Partial<Program> & { id: string } = {
      id,
      code: cleanCode,
      name: cleanName,
      status,
      is_active: status === 'ACTIVE' ? 1 : 0,
      updated_at: now,
    };

    await AcademicRepository.updateProgram(id, updates);

    if (!DataModeService.isDirectSupabase()) {
      try {
        const { error } = await supabase.from('programs').update(updates).eq('id', id);
        if (error) {
          await this.enqueueOutbox('PROGRAM', id, 'UPDATE', updates as unknown as Record<string, unknown>);
        }
      } catch {
        await this.enqueueOutbox('PROGRAM', id, 'UPDATE', updates as unknown as Record<string, unknown>);
      }
    }

    return (await AcademicRepository.getProgramById(id))!;
  }

  public static async toggleProgramStatus(id: string): Promise<Program> {
    await this.verifyDevAdmin();
    const existing = await AcademicRepository.getProgramById(id);
    if (!existing) {
      throw new Error('Program not found.');
    }
    const currentStatus = existing.status || (existing.is_active === 1 ? 'ACTIVE' : 'INACTIVE');
    const newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    return this.updateProgram(id, { status: newStatus });
  }

  public static async deleteProgram(id: string): Promise<void> {
    await this.verifyDevAdmin();
    const sectionCount = await this.getProgramSectionCount(id);
    if (sectionCount > 0) {
      throw new Error(`Cannot delete program because it is assigned to ${sectionCount} section(s). Please reassign or remove those sections first.`);
    }
    const enrollmentCount = await this.getProgramEnrollmentCount(id);
    if (enrollmentCount > 0) {
      throw new Error(`Cannot delete program because it has ${enrollmentCount} student enrollment record(s). Deactivate it instead.`);
    }

    await AcademicRepository.deleteProgram(id);

    if (!DataModeService.isDirectSupabase()) {
      try {
        await supabase.from('programs').delete().eq('id', id);
      } catch {
        await this.enqueueOutbox('PROGRAM', id, 'DELETE', { id });
      }
    }
  }
}
