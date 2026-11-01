import { sha256 } from 'hash-wasm';
import { supabase } from '@/integrations/supabase/client';
import { getDatabase } from '../database/database';
import { StudentsRepository } from '../database/repositories/students.repository';
import { AcademicRepository } from '../database/repositories/academic.repository';
import { ImportsRepository } from '../database/repositories/imports.repository';
import type { ImportBatchRecord } from '@/types/database';
import type { DatabaseAdapter } from '../database/adapters/database-adapter.interface';

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
  lastname: string;
  year: number;
  section: string;
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
}

export class CsvImportService {
  public static async parseAndValidate(
    fileContent: string,
    filename: string,
    _semesterId?: string,
    _programId?: string
  ): Promise<CsvParseResult> {
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

    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const expectedHeaders = ['school_id', 'first_name', 'middle_name', 'lastname', 'year', 'section'];
    const missing = expectedHeaders.filter((h) => !header.includes(h));
    if (missing.length > 0) {
      throw new Error(`Invalid CSV headers. Missing: ${missing.join(', ')}`);
    }

    const colIndex = {
      school_id: header.indexOf('school_id'),
      first_name: header.indexOf('first_name'),
      middle_name: header.indexOf('middle_name'),
      lastname: header.indexOf('lastname'),
      year: header.indexOf('year'),
      section: header.indexOf('section'),
    };

    let academicYearId: string | undefined;
    if (_semesterId) {
      const sem = await AcademicRepository.getSemesterById(_semesterId);
      academicYearId = sem?.academic_year_id;
    }

    const validRows: CsvValidationRow[] = [];
    const invalidRows: CsvValidationRow[] = [];
    const seenSchoolIds = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(',').map((p) => p.trim());
      const rowNum = i + 1;

      const rawSchoolId = parts[colIndex.school_id] || '';
      // Sanitize formula injection
      const schoolId = rawSchoolId.replace(/^[=+\-@]/, '');
      const firstName = (parts[colIndex.first_name] || '').replace(/^[=+\-@]/, '');
      const middleName = (parts[colIndex.middle_name] || '').replace(/^[=+\-@]/, '');
      const lastName = (parts[colIndex.lastname] || '').replace(/^[=+\-@]/, '');
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

      // 1. Verify year level exists in normalized year_levels table
      const yearLevel = await AcademicRepository.getYearLevelByNumber(year);
      if (!yearLevel) {
        invalidRows.push({
          rowNumber: rowNum,
          isValid: false,
          isExistingStudent: false,
          error: `Year level ${year} is not configured in System Setup. DevAdmin setup required.`,
        });
        continue;
      }

      // 2. Verify section belongs to the selected year level
      const matchedSection = await AcademicRepository.getSectionByName(
        section,
        yearLevel.id,
        academicYearId,
        _programId
      );
      const foundSection = matchedSection || (await AcademicRepository.getSectionByName(section, yearLevel.id));

      if (!foundSection) {
        const anySection = await AcademicRepository.getSectionByName(section);
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

      const existing = await StudentsRepository.getStudentBySchoolId(schoolId);
      validRows.push({
        rowNumber: rowNum,
        isValid: true,
        isExistingStudent: existing !== null,
        data: {
          school_id: schoolId,
          first_name: firstName,
          middle_name: middleName || undefined,
          lastname: lastName,
          year,
          section,
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
    importedByUserId: string
  ): Promise<ImportExecutionResult> {
    const db = await getDatabase();
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

    await ImportsRepository.createBatch(batchRecord);

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
        last_name: r.data!.lastname,
        year: r.data!.year,
        section: r.data!.section,
      }));

    // 1. Attempt Atomic Online Server Ingest RPC via Supabase (if online and not in test)
    if (!isTestEnvironment()) {
      try {
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('import_student_roster_batch', {
          p_batch_id: batchId,
          p_source_filename: parseResult.filename,
          p_sha256: parseResult.sha256,
          p_semester_id: semesterId,
          p_program_id: programId,
          p_roster: rosterPayload,
        });

        if (rpcErr) {
          console.error('[CsvImportService] Supabase RPC import_student_roster_batch error:', rpcErr);
          const errMsg = rpcErr.message || String(rpcErr);
          if (errMsg.includes('Unauthorized') || errMsg.includes('Authentication') || errMsg.includes('Permission')) {
            throw new Error(`Authentication/Authorization error: ${errMsg}`);
          }
        } else if (rpcRes && rpcRes.success) {
          serverSynced = true;
          importedCount = (rpcRes.imported_count || 0) + (rpcRes.updated_count || 0);
          rejectedCount += (rpcRes.rejected_count || 0);

          // Mirror server-authoritative results directly into local SQLite
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
              for (const st of rpcRes.students) {
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

                // Upsert enrollment in SQLite
                const existingEnrollment = await AcademicRepository.getStudentEnrollmentInSemester(
                  studentId,
                  semesterId,
                  tx
                );

                if (!existingEnrollment) {
                  await AcademicRepository.createEnrollment(
                    {
                      id: st.enrollment_id || generateUuid(),
                      student_id: studentId,
                      semester_id: semesterId,
                      program_id: programId,
                      year_level: st.year,
                      section: st.section,
                      year_level_id: st.year_level_id || null,
                      section_id: st.section_id || null,
                      enrollment_status: 'ENROLLED',
                      first_name_snapshot: st.first_name,
                      middle_name_snapshot: st.middle_name || null,
                      last_name_snapshot: st.last_name,
                      updated_at: now,
                    },
                    tx
                  );
                }

                await ImportsRepository.recordRow(
                  {
                    id: 'row_' + generateUuid().substring(0, 8),
                    batch_id: batchId,
                    row_number: st.row_number || 0,
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

          return { batchId, importedCount, rejectedCount, serverSynced: true };
        }
      } catch (err: unknown) {
        console.warn('[CsvImportService] Server RPC unavailable, proceeding with local offline import:', err);
        const msg = (err as Error).message || '';
        if (msg.includes('Authentication') || msg.includes('Unauthorized')) {
          throw err;
        }
      }
    }

    // 2. Offline / Local SQLite Fallback Path (also enqueues into sync_outbox)
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
              school_id: d.school_id,
              first_name: d.first_name,
              middle_name: d.middle_name || null,
              last_name: d.lastname,
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
            // Update master name snapshot
            const updatedFields = {
              id: student.id,
              first_name: d.first_name,
              middle_name: d.middle_name || null,
              last_name: d.lastname,
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
              const yl = await AcademicRepository.getYearLevelByNumber(d.year, tx);
              const sec = yl ? await AcademicRepository.getSectionByName(d.section, yl.id, undefined, programId, tx) : null;
              const enrollmentId = generateUuid();
              const newEnrollment = {
                id: enrollmentId,
                student_id: student.id,
                semester_id: semesterId,
                program_id: programId,
                year_level: d.year,
                section: d.section,
                year_level_id: yl?.id || null,
                section_id: sec?.id || null,
                enrollment_status: 'ENROLLED' as const,
                first_name_snapshot: d.first_name,
                middle_name_snapshot: d.middle_name || null,
                last_name_snapshot: d.lastname,
                updated_at: now,
              };
              await AcademicRepository.createEnrollment(newEnrollment, tx);

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

    return { batchId, importedCount, rejectedCount, serverSynced };
  }
}
