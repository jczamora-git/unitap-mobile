import { sha256 } from 'hash-wasm';
import { getDatabase } from '../database/database';
import { StudentsRepository } from '../database/repositories/students.repository';
import { AcademicRepository } from '../database/repositories/academic.repository';
import { ImportsRepository } from '../database/repositories/imports.repository';
import type { ImportBatchRecord } from '@/types/database';

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
  ): Promise<{ batchId: string; importedCount: number; rejectedCount: number }> {
    const db = await getDatabase();
    const batchId = 'imp_' + Math.random().toString(36).substring(2, 10);
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

    await db.transaction(async (tx) => {
      // 1. Record invalid rows in import_rows
      for (const inv of parseResult.invalidRows) {
        await ImportsRepository.recordRow(
          {
            id: 'row_' + Math.random().toString(36).substring(2, 10),
            batch_id: batchId,
            row_number: inv.rowNumber,
            raw_json: JSON.stringify(inv),
            result: 'REJECTED',
            error_message: inv.error,
          },
          tx
        );
      }

      // 2. Process valid rows
      for (const val of parseResult.validRows) {
        if (!val.data) continue;
        const d = val.data;

        try {
          let student = await StudentsRepository.getStudentBySchoolId(d.school_id, tx);
          if (!student) {
            const studentId = 'stu_' + Math.random().toString(36).substring(2, 10);
            await StudentsRepository.createStudent(
              {
                id: studentId,
                school_id: d.school_id,
                first_name: d.first_name,
                middle_name: d.middle_name || null,
                last_name: d.lastname,
                status: 'ACTIVE',
                created_at: now,
                updated_at: now,
              },
              tx
            );
            student = await StudentsRepository.getStudentById(studentId, tx);
          } else {
            // Update master name snapshot if approved
            await StudentsRepository.updateStudent(
              {
                id: student.id,
                first_name: d.first_name,
                middle_name: d.middle_name || null,
                last_name: d.lastname,
                updated_at: now,
              },
              tx
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
              await AcademicRepository.createEnrollment(
                {
                  id: 'enr_' + Math.random().toString(36).substring(2, 10),
                  student_id: student.id,
                  semester_id: semesterId,
                  program_id: programId,
                  year_level: d.year,
                  section: d.section,
                  year_level_id: yl?.id || null,
                  section_id: sec?.id || null,
                  enrollment_status: 'ENROLLED',
                  first_name_snapshot: d.first_name,
                  middle_name_snapshot: d.middle_name || null,
                  last_name_snapshot: d.lastname,
                  updated_at: now,
                },
                tx
              );
            }

            // Create default profile confirmation row as PENDING for new semester
            await StudentsRepository.createProfileConfirmation(
              {
                id: 'pconf_' + Math.random().toString(36).substring(2, 10),
                student_id: student.id,
                semester_id: semesterId,
                status: 'PENDING',
              },
              tx
            );

            await ImportsRepository.recordRow(
              {
                id: 'row_' + Math.random().toString(36).substring(2, 10),
                batch_id: batchId,
                row_number: val.rowNumber,
                raw_json: JSON.stringify(d),
                result: val.isExistingStudent ? 'UPDATED' : 'IMPORTED',
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
              id: 'row_' + Math.random().toString(36).substring(2, 10),
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

    return { batchId, importedCount, rejectedCount };
  }
}
