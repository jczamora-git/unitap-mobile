import { sha256 } from 'hash-wasm';
import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '../database/database';
import { StudentsRepository } from '../database/repositories/students.repository';
import { AcademicRepository } from '../database/repositories/academic.repository';
import { ImportsRepository } from '../database/repositories/imports.repository';
import type { ImportBatchRecord } from '@/types/database';
import type { DatabaseAdapter } from '../database/adapters/database-adapter.interface';
import { normalizeSchoolId } from '@/utilities/school-id-normalizer';
import { DataModeService } from './data-mode.service';

function isTestEnvironment(): boolean {
  if ((globalThis as unknown as { __FORCE_ONLINE_TEST__?: boolean }).__FORCE_ONLINE_TEST__) {
    return false;
  }
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  return (
    proc?.env?.VITEST === 'true' ||
    proc?.env?.NODE_ENV === 'test' ||
    (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test')
  );
}

async function ensureDefaultDevice(tx: DatabaseAdapter, now: string): Promise<string> {
  await tx.execute(
    `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
     VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
    [now]
  );
  return 'dev_default';
}

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

export interface CsvRowData {
  school_id: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  lastname: string;
  year: number;
  section: string;
  year_level_id?: string;
  section_id?: string;
}

export interface CsvValidationRow {
  rowNumber: number;
  data?: CsvRowData;
  isValid: boolean;
  isExistingStudent: boolean;
  error?: string;
}

export interface CsvParseResult {
  filename: string;
  sha256: string;
  totalRows: number;
  validRows: CsvValidationRow[];
  invalidRows: CsvValidationRow[];
}

export interface ImportExecutionResult {
  batchId: string;
  importedCount: number;
  rejectedCount: number;
  serverSynced: boolean;
  enrolledCount: number;
  skippedCount: number;
  updatedCount?: number;
  totalRows: number;
  completedAt: string;
}

export class CsvImportService {
  private static _isImportInProgress = false;

  public static isImportInProgress(): boolean {
    return this._isImportInProgress;
  }

  public static resetImportLock(): void {
    this._isImportInProgress = false;
  }

  public static async findExistingBatch(
    sha256Hash: string,
    semesterId: string
  ): Promise<ImportBatchRecord | null> {
    try {
      if (DataModeService.isDirectSupabase() && !isTestEnvironment()) {
        const { data, error } = await supabase
          .from('import_batches')
          .select('*')
          .eq('sha256', sha256Hash)
          .eq('semester_id', semesterId)
          .eq('status', 'COMPLETED')
          .order('imported_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) {
          return data as ImportBatchRecord;
        }
      }
      return await ImportsRepository.getBatchBySha256(sha256Hash, semesterId);
    } catch {
      return null;
    }
  }
  public static async parseAndValidate(
    fileContent: string,
    filename: string,
    _semesterId?: string,
    _programId?: string,
    abortSignal?: AbortSignal
  ): Promise<CsvParseResult> {
    if (abortSignal?.aborted) {
      throw new Error('CSV validation was cancelled by user.');
    }

    const fileHash = await sha256(fileContent);
    const lines = fileContent
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length < 2) {
      throw new Error('CSV file is empty or missing data rows.');
    }

    const header = lines[0].split(',').map((h) => h.trim().replace(/^["']|["']$/g, '').trim().toLowerCase());

    const hasLastName = header.includes('last_name');
    const hasLastname = header.includes('lastname');

    if (hasLastName && hasLastname) {
      throw new Error('Ambiguous CSV headers: Contains both "last_name" and "lastname". Please provide only one column for student last name.');
    }

    const expectedHeaders = ['school_id', 'first_name', 'middle_name', 'year', 'section'];
    const missing = expectedHeaders.filter((h) => !header.includes(h));
    if (!hasLastName && !hasLastname) {
      missing.push('last_name');
    }

    if (missing.length > 0) {
      throw new Error(`Invalid CSV headers. Missing: ${missing.join(', ')}`);
    }

    const lastNameIndex = hasLastName ? header.indexOf('last_name') : header.indexOf('lastname');

    const colIndex = {
      school_id: header.indexOf('school_id'),
      first_name: header.indexOf('first_name'),
      middle_name: header.indexOf('middle_name'),
      last_name: lastNameIndex,
      lastname: lastNameIndex,
      year: header.indexOf('year'),
      section: header.indexOf('section'),
    };

    let academicYearId: string | undefined;
    let targetSemester = null;
    if (_semesterId && _semesterId.trim()) {
      targetSemester = await AcademicRepository.getSemesterById(_semesterId.trim());
      if (!targetSemester) {
        throw new Error(`Cannot accept import: Target semester "${_semesterId}" does not exist in the database.`);
      }
      academicYearId = targetSemester.academic_year_id;
    } else {
      const activeSem = await AcademicRepository.getActiveSemester();
      if (activeSem) {
        targetSemester = activeSem;
        academicYearId = activeSem.academic_year_id;
      }
    }

    if (abortSignal?.aborted) {
      throw new Error('CSV validation was cancelled by user.');
    }

    let targetProgram = null;
    if (_programId && _programId.trim()) {
      targetProgram = await AcademicRepository.getProgramById(_programId.trim());
      if (!targetProgram) {
        throw new Error(`Cannot accept import: Program "${_programId}" does not exist in the database.`);
      }
    } else {
      const allPrograms = await AcademicRepository.getPrograms();
      if (allPrograms.length > 0) {
        targetProgram = allPrograms[0];
      }
    }

    if (abortSignal?.aborted) {
      throw new Error('CSV validation was cancelled by user.');
    }

    // Pre-fetch year levels and sections to avoid 600+ sequential HTTP roundtrips
    const allYearLevels = await AcademicRepository.getYearLevels();
    if (abortSignal?.aborted) {
      throw new Error('CSV validation was cancelled by user.');
    }
    const allSections = await AcademicRepository.getSections();
    if (abortSignal?.aborted) {
      throw new Error('CSV validation was cancelled by user.');
    }

    const yearLevelByNumMap = new Map<number, (typeof allYearLevels)[0]>();
    for (const yl of allYearLevels) {
      yearLevelByNumMap.set(yl.level_number, yl);
    }

    const sectionByNameAndYlMap = new Map<string, (typeof allSections)[0]>();
    const sectionByNameMap = new Map<string, (typeof allSections)[0]>();
    for (const sec of allSections) {
      const cleanName = sec.section_name.trim().toLowerCase();
      sectionByNameAndYlMap.set(`${cleanName}__${sec.year_level_id}`, sec);
      if (!sectionByNameMap.has(cleanName)) {
        sectionByNameMap.set(cleanName, sec);
      }
    }

    // Collect all candidate school IDs for bulk batch check (0 per-row queries)
    const allCandidateSchoolIds: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      const rawSchoolId = parts[colIndex.school_id] || '';
      const schoolId = normalizeSchoolId(rawSchoolId.replace(/^[=+\-@]/, ''));
      if (schoolId) {
        allCandidateSchoolIds.push(schoolId);
      }
    }

    // Bulk lookup existing students in chunks of 100
    const existingSchoolIdsSet = new Set<string>();
    if (allCandidateSchoolIds.length > 0) {
      const CHUNK_SIZE = 100;
      if (DataModeService.isDirectSupabase() && !isTestEnvironment()) {
        try {
          for (let i = 0; i < allCandidateSchoolIds.length; i += CHUNK_SIZE) {
            if (abortSignal?.aborted) {
              throw new Error('CSV validation was cancelled by user.');
            }
            const chunk = allCandidateSchoolIds.slice(i, i + CHUNK_SIZE);
            const { data, error } = await supabase
              .from('students')
              .select('school_id')
              .in('school_id', chunk);
            if (!error && Array.isArray(data)) {
              for (const item of data) {
                if (item.school_id) existingSchoolIdsSet.add(item.school_id.trim().toLowerCase());
              }
            }
          }
        } catch (supaErr) {
          console.warn('[CsvImportService] Bulk Supabase student check fallback:', supaErr);
        }
      } else {
        const db = await getDatabase();
        for (let i = 0; i < allCandidateSchoolIds.length; i += CHUNK_SIZE) {
          if (abortSignal?.aborted) {
            throw new Error('CSV validation was cancelled by user.');
          }
          const chunk = allCandidateSchoolIds.slice(i, i + CHUNK_SIZE);
          const placeholders = chunk.map(() => '?').join(', ');
          const rows = await db.query<{ school_id: string }>(
            `SELECT school_id FROM students WHERE school_id IN (${placeholders}) COLLATE NOCASE`,
            chunk
          );
          for (const r of rows) {
            if (r.school_id) existingSchoolIdsSet.add(r.school_id.trim().toLowerCase());
          }
        }
      }
    }

    const validRows: CsvValidationRow[] = [];
    const invalidRows: CsvValidationRow[] = [];
    const seenSchoolIds = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      if (abortSignal?.aborted) {
        throw new Error('CSV validation was cancelled by user.');
      }

      const line = lines[i];
      const parts = line.split(',').map((p) => p.trim());
      const rowNum = i + 1;

      const rawSchoolId = parts[colIndex.school_id] || '';
      // Sanitize formula injection and canonicalize School ID
      const schoolId = normalizeSchoolId(rawSchoolId.replace(/^[=+\-@]/, ''));
      const firstName = (parts[colIndex.first_name] || '').replace(/^[=+\-@]/, '').trim();
      const middleName = (parts[colIndex.middle_name] || '').replace(/^[=+\-@]/, '').trim();
      const lastName = (parts[colIndex.last_name] || '').replace(/^[=+\-@]/, '').trim();
      const year = parseInt(parts[colIndex.year] || '', 10);
      const section = (parts[colIndex.section] || '').replace(/^[=+\-@]/, '');

      if (!schoolId) {
        invalidRows.push({ rowNumber: rowNum, isValid: false, isExistingStudent: false, error: 'school_id is required' });
        continue;
      }
      if (seenSchoolIds.has(schoolId.toLowerCase())) {
        invalidRows.push({ rowNumber: rowNum, isValid: false, isExistingStudent: false, error: `Duplicate school_id ${schoolId} in file` });
        continue;
      }
      seenSchoolIds.add(schoolId.toLowerCase());

      if (!firstName || !lastName) {
        invalidRows.push({ rowNumber: rowNum, isValid: false, isExistingStudent: false, error: 'First name and Last name are required' });
        continue;
      }
      if (isNaN(year) || year < 1 || year > 8) {
        invalidRows.push({ rowNumber: rowNum, isValid: false, isExistingStudent: false, error: 'Year must be a number between 1 and 8' });
        continue;
      }
      if (!section) {
        invalidRows.push({ rowNumber: rowNum, isValid: false, isExistingStudent: false, error: 'Section is required' });
        continue;
      }

      // 1. Verify year level exists (using memory map with fallback)
      const yearLevel = yearLevelByNumMap.get(year) || (await AcademicRepository.getYearLevelByNumber(year));
      if (!yearLevel) {
        invalidRows.push({
          rowNumber: rowNum,
          isValid: false,
          isExistingStudent: false,
          error: `Year level ${year} is not configured in System Setup. DevAdmin setup required.`,
        });
        continue;
      }

      // 2. Verify section belongs to the selected year level & program foreign keys
      const cleanSecName = section.trim().toLowerCase();
      const matchedSection = sectionByNameAndYlMap.get(`${cleanSecName}__${yearLevel.id}`)
        || (await AcademicRepository.getSectionByName(section, yearLevel.id, academicYearId, _programId || targetProgram?.id))
        || (await AcademicRepository.getSectionByName(section, yearLevel.id));

      if (!matchedSection) {
        const anySection = sectionByNameMap.get(cleanSecName) || (await AcademicRepository.getSectionByName(section));
        if (anySection) {
          invalidRows.push({
            rowNumber: rowNum,
            isValid: false,
            isExistingStudent: false,
            error: `Section "${section}" belongs to a different year level. DevAdmin setup required.`,
          });
        } else {
          invalidRows.push({
            rowNumber: rowNum,
            isValid: false,
            isExistingStudent: false,
            error: `Section "${section}" is not configured for ${yearLevel.display_name}. DevAdmin setup required.`,
          });
        }
        continue;
      }
      const foundSection = matchedSection;

      const isExisting = existingSchoolIdsSet.has(schoolId.trim().toLowerCase());
      validRows.push({
        rowNumber: rowNum,
        isValid: true,
        isExistingStudent: isExisting,
        data: {
          school_id: schoolId,
          first_name: firstName,
          middle_name: middleName || undefined,
          last_name: lastName,
          lastname: lastName,
          year,
          section,
          year_level_id: yearLevel.id,
          section_id: foundSection.id,
        },
      });
    }

    return {
      filename,
      sha256: fileHash,
      totalRows: lines.length - 1,
      validRows,
      invalidRows,
    };
  }

  public static async executeImport(
    parseResult: CsvParseResult,
    semesterId: string,
    programId: string,
    importedByUserId: string,
    abortSignal?: AbortSignal
  ): Promise<ImportExecutionResult> {
    if (abortSignal?.aborted) {
      throw new Error('Import operation was cancelled by user.');
    }

    if (this._isImportInProgress) {
      throw new Error('An import operation is already in progress. Duplicate submissions are prevented.');
    }
    this._isImportInProgress = true;

    try {
      if (!semesterId || !semesterId.trim()) {
        throw new Error('Foreign key required: Target semester is required for enrollment.');
      }
      if (!programId || !programId.trim()) {
        throw new Error('Foreign key required: Program is required for enrollment.');
      }

      const targetSemester = await AcademicRepository.getSemesterById(semesterId.trim());
      if (!targetSemester) {
        throw new Error(`Foreign key constraint failed: Target semester "${semesterId}" does not exist in the database.`);
      }

      const targetProgram = await AcademicRepository.getProgramById(programId.trim());
      if (!targetProgram) {
        throw new Error(`Foreign key constraint failed: Program "${programId}" does not exist in the database.`);
      }

      if (!parseResult.validRows || parseResult.validRows.length === 0) {
        throw new Error('Cannot accept import: No valid student records with matched foreign keys were found.');
      }

      const isDirect = DataModeService.isDirectSupabase();
      const batchId = 'imp_' + generateUuid().substring(0, 8);
      const now = new Date().toISOString();

      const batchRecord: ImportBatchRecord = {
        id: batchId,
        semester_id: semesterId,
        source_filename: parseResult.filename,
        sha256: parseResult.sha256,
        imported_by_user_id: importedByUserId,
        imported_at: now,
        status: 'VALIDATING',
        total_rows: parseResult.totalRows,
        imported_rows: 0,
        rejected_rows: parseResult.invalidRows.length,
      };

      // In Direct Supabase Mode, do not attempt local SQLite writes as the authoritative operation.
      // The import_student_roster_batch RPC creates and manages the import_batches row directly in Supabase.
      if (!isDirect) {
        await ImportsRepository.createBatch(batchRecord);
      }

      let importedCount = 0;
      let rejectedCount = parseResult.invalidRows.length;
      let serverSynced = false;

      // Prepare roster elements with valid UUIDs
      const rosterPayload = parseResult.validRows
        .filter((r) => Boolean(r.data))
        .map((r) => ({
          id: generateUuid(),
          row_number: r.rowNumber,
          school_id: r.data!.school_id,
          first_name: r.data!.first_name,
          middle_name: r.data!.middle_name || null,
          last_name: r.data!.last_name || r.data!.lastname,
          year: r.data!.year,
          section: r.data!.section,
        }));

      // 1. Attempt Atomic Online Server Ingest RPC via Supabase (if online and not in test, or if in direct mode)
      if (!isTestEnvironment() || isDirect) {
        if (abortSignal?.aborted) {
          throw new Error('Import operation was cancelled by user.');
        }
        try {
          const { data: rpcRes, error: rpcErr } = await supabase.rpc('import_student_roster_batch', {
            p_batch_id: batchId,
            p_source_filename: parseResult.filename,
            p_sha256: parseResult.sha256,
            p_semester_id: semesterId,
            p_program_id: programId,
            p_roster: rosterPayload,
          });

          if (abortSignal?.aborted) {
            throw new Error('Import operation was cancelled by user.');
          }

          if (rpcErr) {
            console.error('[CsvImportService] Supabase RPC import_student_roster_batch error:', rpcErr);
            const errMsg = rpcErr.message || String(rpcErr);
            throw new Error(`Server import rejected: ${errMsg}`);
          } else if (rpcRes && rpcRes.success) {
            serverSynced = true;
            importedCount = (rpcRes.imported_count || 0) + (rpcRes.updated_count || 0);
            rejectedCount += (rpcRes.rejected_count || 0);

            // In Direct Supabase Mode, Supabase is the sole authoritative store; SQLite sync is paused.
            // Only mirror into local SQLite when running in offline-first mode.
            if (!isDirect) {
              try {
                const db = await getDatabase();
                await db.transaction(async (tx) => {
                  // Record invalid rows from parse
                  for (const inv of parseResult.invalidRows) {
                    await ImportsRepository.recordRow(
                      {
                        id: 'row_' + generateUuid().substring(0, 8),
                        batch_id: batchId,
                        row_number: inv.rowNumber,
                        raw_json: JSON.stringify(inv),
                        result: 'REJECTED',
                        error_message: inv.error,
                      },
                      tx
                    );
                  }

                  // Ingest server-returned students & enrollments
                  if (Array.isArray(rpcRes.students)) {
                    for (let idx = 0; idx < rpcRes.students.length; idx++) {
                      const st = rpcRes.students[idx];
                      const existing = await StudentsRepository.getStudentBySchoolId(st.school_id, tx);
                      const studentId = existing ? existing.id : st.id;

                      if (!existing) {
                        await StudentsRepository.createStudent(
                          {
                            id: studentId,
                            school_id: st.school_id,
                            first_name: st.first_name,
                            middle_name: st.middle_name || null,
                            last_name: st.last_name,
                            status: 'ACTIVE',
                            created_at: now,
                            updated_at: now,
                          },
                          tx
                        );
                      } else {
                        await StudentsRepository.updateStudent(
                          {
                            id: studentId,
                            first_name: st.first_name,
                            middle_name: st.middle_name || null,
                            last_name: st.last_name,
                            updated_at: now,
                          },
                          tx
                        );
                      }

                      // Resolve local year level & section for SQLite foreign key integrity
                      const yl = (st.year_level_id ? await AcademicRepository.getYearLevelById(st.year_level_id, tx) : null)
                        || (await AcademicRepository.getYearLevelByNumber(st.year, tx));
                      const sec = (st.section_id ? await AcademicRepository.getSectionById(st.section_id, tx) : null)
                        || (yl ? await AcademicRepository.getSectionByName(st.section, yl.id, undefined, programId, tx) : null);

                      // Upsert enrollment in SQLite only if valid FKs exist
                      const existingEnrollment = await AcademicRepository.getStudentEnrollmentInSemester(
                        studentId,
                        semesterId,
                        tx
                      );

                      if (!existingEnrollment && yl && sec) {
                        await AcademicRepository.createEnrollment(
                          {
                            id: st.enrollment_id || generateUuid(),
                            student_id: studentId,
                            semester_id: semesterId,
                            program_id: programId,
                            year_level: st.year,
                            section: st.section,
                            year_level_id: yl.id,
                            section_id: sec.id,
                            enrollment_status: 'ENROLLED' as const,
                            first_name_snapshot: st.first_name,
                            middle_name_snapshot: st.middle_name || null,
                            last_name_snapshot: st.last_name,
                            updated_at: now,
                          },
                          tx
                        );
                      }

                      const rowNum = st.row_number || idx + 1;
                      await ImportsRepository.recordRow(
                        {
                          id: 'row_' + generateUuid().substring(0, 8),
                          batch_id: batchId,
                          row_number: rowNum,
                          raw_json: JSON.stringify(st),
                          result: st.is_existing ? 'UPDATED' : 'IMPORTED',
                          student_id: studentId,
                        },
                        tx
                      );
                    }
                  }

                  const finalStatus = rejectedCount === 0 ? 'COMPLETED' : importedCount > 0 ? 'PARTIAL' : 'FAILED';
                  await ImportsRepository.updateBatchSummary(
                    batchId,
                    finalStatus,
                    parseResult.totalRows,
                    importedCount,
                    rejectedCount,
                    tx
                  );
                });
              } catch (mirrorErr) {
                console.error('[CsvImportService] Error mirroring server batch to local SQLite:', mirrorErr);
              }
            }

            const enrolledCount = rpcRes.enrolled_count ?? (rpcRes.imported_count || 0) + (rpcRes.updated_count || 0);
            const skippedCount = rpcRes.skipped_count ?? 0;
            return {
              batchId,
              importedCount,
              rejectedCount,
              serverSynced: true,
              enrolledCount,
              updatedCount: rpcRes.updated_count || 0,
              skippedCount,
              totalRows: parseResult.totalRows,
              completedAt: new Date().toISOString(),
            };
          } else {
            const errDetail = rpcRes?.error || 'Remote import RPC completed without success confirmation.';
            throw new Error(`Server import rejected: ${errDetail}`);
          }
        } catch (err: unknown) {
          if (isDirect) {
            throw err;
          }
          console.warn('[CsvImportService] Server RPC unavailable, proceeding with local offline import:', err);
          const msg = (err as Error).message || '';
          if (
            msg.includes('Authentication') ||
            msg.includes('Unauthorized') ||
            msg.includes('Foreign key') ||
            msg.includes('not found')
          ) {
            throw err;
          }
        }
      }

      if (isDirect) {
        throw new Error('Direct Supabase Mode requires authorized remote import, but RPC was not executed.');
      }

      // 2. Offline / Local SQLite Fallback Path (also enqueues into sync_outbox)
      let newlyEnrolled = 0;
      let updatedStudents = 0;
      let skippedCount = 0;

      const db = await getDatabase();
      await db.transaction(async (tx) => {
        await ensureDefaultDevice(tx, now);

        // 2a. Record invalid rows in import_rows
        for (const inv of parseResult.invalidRows) {
          await ImportsRepository.recordRow(
            {
              id: 'row_' + generateUuid().substring(0, 8),
              batch_id: batchId,
              row_number: inv.rowNumber,
              raw_json: JSON.stringify(inv),
              result: 'REJECTED',
              error_message: inv.error,
            },
            tx
          );
        }

        // 2b. Process valid rows locally & queue to outbox
        for (const val of parseResult.validRows) {
          if (!val.data) continue;
          const d = val.data;

          try {
            let student = await StudentsRepository.getStudentBySchoolId(d.school_id, tx);
            const isNew = !student;

            if (!student) {
              const studentId = generateUuid();
              const newStudent = {
                id: studentId,
                school_id: normalizeSchoolId(d.school_id),
                first_name: d.first_name,
                middle_name: d.middle_name || null,
                last_name: d.last_name || d.lastname,
                status: 'ACTIVE' as const,
                created_at: now,
                updated_at: now,
              };
              await StudentsRepository.createStudent(newStudent, tx);
              student = await StudentsRepository.getStudentById(studentId, tx);

              // Queue student CREATE to sync_outbox
              await tx.execute(
                `INSERT INTO sync_outbox (
                  id, device_id, entity_type, entity_id, operation, payload_json,
                  schema_version, created_at, retry_count
                ) VALUES (?, 'dev_default', 'STUDENT', ?, 'CREATE', ?, 1, ?, 0)`,
                [
                  'out_' + generateUuid().substring(0, 8),
                  studentId,
                  JSON.stringify(newStudent),
                  now,
                ]
              );
            } else {
              updatedStudents++;
              // Update master name snapshot
              const updatedFields = {
                id: student.id,
                first_name: d.first_name,
                middle_name: d.middle_name || null,
                last_name: d.last_name || d.lastname,
                updated_at: now,
              };
              await StudentsRepository.updateStudent(updatedFields, tx);

              // Queue student UPDATE to sync_outbox
              await tx.execute(
                `INSERT INTO sync_outbox (
                  id, device_id, entity_type, entity_id, operation, payload_json,
                  schema_version, created_at, retry_count
                ) VALUES (?, 'dev_default', 'STUDENT', ?, 'UPDATE', ?, 1, ?, 0)`,
                [
                  'out_' + generateUuid().substring(0, 8),
                  student.id,
                  JSON.stringify({ ...student, ...updatedFields }),
                  now,
                ]
              );
            }

            if (student) {
              // Check enrollment in this semester
              const existingEnrollment = await AcademicRepository.getStudentEnrollmentInSemester(
                student.id,
                semesterId,
                tx
              );

              if (!existingEnrollment) {
                const yl = (val.data?.year_level_id ? await AcademicRepository.getYearLevelById(val.data.year_level_id, tx) : null)
                  || (await AcademicRepository.getYearLevelByNumber(d.year, tx));
                const sec = (val.data?.section_id ? await AcademicRepository.getSectionById(val.data.section_id, tx) : null)
                  || (yl ? await AcademicRepository.getSectionByName(d.section, yl.id, undefined, programId, tx) : null);

                if (!yl || !sec) {
                  // Must not insert enrollment with orphan foreign keys
                  await ImportsRepository.recordRow(
                    {
                      id: 'row_' + generateUuid().substring(0, 8),
                      batch_id: batchId,
                      row_number: val.rowNumber,
                      raw_json: JSON.stringify(d),
                      result: 'REJECTED',
                      error_message: `Foreign key mismatch: Year level ${d.year} or section "${d.section}" not found in database.`,
                    },
                    tx
                  );
                  rejectedCount++;
                  continue;
                }

                const enrollmentId = generateUuid();
                const newEnrollment = {
                  id: enrollmentId,
                  student_id: student.id,
                  semester_id: semesterId,
                  program_id: programId,
                  year_level: d.year,
                  section: d.section,
                  year_level_id: yl.id,
                  section_id: sec.id,
                  enrollment_status: 'ENROLLED' as const,
                  first_name_snapshot: d.first_name,
                  middle_name_snapshot: d.middle_name || null,
                  last_name_snapshot: d.last_name || d.lastname,
                  updated_at: now,
                };
                await AcademicRepository.createEnrollment(newEnrollment, tx);
                newlyEnrolled++;

                // Queue enrollment CREATE to sync_outbox
                await tx.execute(
                  `INSERT INTO sync_outbox (
                    id, device_id, entity_type, entity_id, operation, payload_json,
                    schema_version, created_at, retry_count
                  ) VALUES (?, 'dev_default', 'ENROLLMENT', ?, 'CREATE', ?, 1, ?, 0)`,
                  [
                    'out_' + generateUuid().substring(0, 8),
                    enrollmentId,
                    JSON.stringify(newEnrollment),
                    now,
                  ]
                );
              } else {
                skippedCount++;
              }

              // Create default profile confirmation row as PENDING for new semester
              await StudentsRepository.createProfileConfirmation(
                {
                  id: generateUuid(),
                  student_id: student.id,
                  semester_id: semesterId,
                  status: 'PENDING',
                },
                tx
              );

              await ImportsRepository.recordRow(
                {
                  id: 'row_' + generateUuid().substring(0, 8),
                  batch_id: batchId,
                  row_number: val.rowNumber,
                  raw_json: JSON.stringify(d),
                  result: isNew ? 'IMPORTED' : 'UPDATED',
                  student_id: student.id,
                },
                tx
              );
              importedCount++;
            }
          } catch (err: unknown) {
            rejectedCount++;
            await ImportsRepository.recordRow(
              {
                id: 'row_' + generateUuid().substring(0, 8),
                batch_id: batchId,
                row_number: val.rowNumber,
                raw_json: JSON.stringify(d),
                result: 'REJECTED',
                error_message: (err as Error).message,
              },
              tx
            );
          }
        }

        const finalStatus = rejectedCount === 0 ? 'COMPLETED' : importedCount > 0 ? 'PARTIAL' : 'FAILED';
        await ImportsRepository.updateBatchSummary(
          batchId,
          finalStatus,
          parseResult.totalRows,
          importedCount,
          rejectedCount,
          tx
        );
      });

      return {
        batchId,
        importedCount,
        rejectedCount,
        serverSynced,
        enrolledCount: newlyEnrolled,
        updatedCount: updatedStudents,
        skippedCount,
        totalRows: parseResult.totalRows,
        completedAt: new Date().toISOString(),
      };
    } finally {
      this._isImportInProgress = false;
    }
  }
}
