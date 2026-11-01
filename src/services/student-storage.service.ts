import { Preferences } from '@capacitor/preferences';
import type { 
  Student, 
  NfcCardRecord, 
  YearLevel, 
  StudentStatus, 
  NfcCardStatus 
} from '@/types/student';
import { 
  StudentsRepository, 
  type StudentWithEnrollment 
} from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { getDatabase } from '@/database/database';

const STUDENTS_STORAGE_KEY = 'nfc_inspector_students_v1';

export interface IStudentRepository {
  getAll(): Promise<Student[]>;
  getById(id: string): Promise<Student | null>;
  getByStudentNumber(studentNumber: string): Promise<Student | null>;
  getByRfid(rfidUid: string): Promise<Student | null>;
  save(student: Student): Promise<Student>;
  delete(id: string): Promise<void>;
  saveAll(students: Student[]): Promise<void>;
  clearCache(): void;
}

export class LocalStudentRepository implements IStudentRepository {
  private cache: Student[] | null = null;

  clearCache(): void {
    this.cache = null;
  }

  async getAll(): Promise<Student[]> {
    if (this.cache !== null) {
      return [...this.cache];
    }

    // 1. Primary Source of Truth: Local SQLite Database
    try {
      const records = await StudentsRepository.getStudents();
      if (records && records.length > 0) {
        const mapped = records.map(r => this.mapSqliteToStudent(r));
        this.cache = mapped;
        return [...this.cache];
      }
    } catch (err) {
      console.warn('[LocalStudentRepository] SQLite getStudents error, checking fallback:', err);
    }

    // 2. Backward-Compatible Fallback: Legacy Capacitor Preferences (nfc_inspector_students_v1)
    try {
      const { value } = await Preferences.get({ key: STUDENTS_STORAGE_KEY });
      let records: Student[] = [];
      if (value) {
        const parsed = JSON.parse(value);
        records = Array.isArray(parsed) ? parsed : [];
      } else {
        const local = typeof localStorage !== 'undefined' ? localStorage.getItem(STUDENTS_STORAGE_KEY) : null;
        records = local ? JSON.parse(local) : [];
      }

      if (records.length > 0) {
        const normalized = records.map(student => this.normalizeLegacyStudent(student));
        this.cache = normalized;
        // Background migration into SQLite for future queries
        this.migrateToSqlite(normalized).catch(migrationErr => {
          console.warn('[LocalStudentRepository] Background migration error:', migrationErr);
        });
        return [...this.cache];
      }
    } catch (err) {
      console.error('[LocalStudentRepository] Error loading students from Preferences fallback:', err);
    }

    this.cache = [];
    return [];
  }

  async getById(id: string): Promise<Student | null> {
    if (!id) return null;
    try {
      const records = await StudentsRepository.getStudents();
      const found = records.find(r => r.id === id);
      if (found) {
        return this.mapSqliteToStudent(found);
      }
    } catch (err) {
      console.warn('[LocalStudentRepository] SQLite getById error:', err);
    }

    const students = await this.getAll();
    return students.find(s => s.id === id) || null;
  }

  async getByStudentNumber(studentNumber: string): Promise<Student | null> {
    if (!studentNumber || !studentNumber.trim()) return null;
    const cleanNum = studentNumber.trim().toLowerCase();
    try {
      const records = await StudentsRepository.getStudents();
      const found = records.find(r => r.school_id && r.school_id.trim().toLowerCase() === cleanNum);
      if (found) {
        return this.mapSqliteToStudent(found);
      }
    } catch (err) {
      console.warn('[LocalStudentRepository] SQLite getByStudentNumber error:', err);
    }

    const students = await this.getAll();
    return students.find(s => s.studentNumber && s.studentNumber.trim().toLowerCase() === cleanNum) || null;
  }

  async getByRfid(rfidUid: string): Promise<Student | null> {
    if (!rfidUid) return null;
    const cleanUid = rfidUid.trim().toUpperCase();
    const compactUid = cleanUid.replace(/[^0-9A-F]/g, '');

    const students = await this.getAll();
    return (
      students.find(s => {
        // Check active card in cards history
        if (s.cards && s.cards.length > 0) {
          const activeCard = s.cards.find(c => c.status === 'ACTIVE');
          if (activeCard) {
            const cardUid = activeCard.rfidUid.trim().toUpperCase();
            const cardCompact = (activeCard.rfidUidCompact || cardUid).replace(/[^0-9A-F]/g, '');
            if (cardUid === cleanUid || cardCompact === compactUid) return true;
          }
        }

        // Fallback to legacy fields
        if (!s.rfidUid) return false;
        const studentUid = s.rfidUid.trim().toUpperCase();
        const studentCompact = (s.rfidUidCompact || studentUid).replace(/[^0-9A-F]/g, '');
        return studentUid === cleanUid || studentCompact === compactUid;
      }) || null
    );
  }

  async save(student: Student): Promise<Student> {
    this.clearCache();
    const now = student.updatedAt || new Date().toISOString();

    try {
      const db = await getDatabase();
      await db.transaction(async (tx) => {
        const existing = await StudentsRepository.getStudentById(student.id, tx);
        if (existing) {
          await StudentsRepository.updateStudent({
            id: student.id,
            first_name: student.firstName,
            middle_name: student.middleName || null,
            last_name: student.lastName,
            status: student.status || 'ACTIVE',
            updated_at: now,
          }, tx);
        } else {
          await StudentsRepository.createStudent({
            id: student.id,
            school_id: student.studentNumber || `STU-${student.id.substring(0, 8)}`,
            first_name: student.firstName,
            middle_name: student.middleName || null,
            last_name: student.lastName,
            status: student.status || 'ACTIVE',
            created_at: student.createdAt || now,
            updated_at: now,
          }, tx);
        }

        // Academic Enrollment
        const activeSem = await AcademicRepository.getActiveSemester(tx);
        if (activeSem) {
          const existingEnrollment = await AcademicRepository.getStudentEnrollmentInSemester(student.id, activeSem.id, tx);
          if (existingEnrollment) {
            await tx.execute(
              `UPDATE student_enrollments SET year_level = ?, section = ?, updated_at = ? WHERE id = ?`,
              [student.yearLevel, student.section, now, existingEnrollment.id]
            );
          } else {
            const yl = await AcademicRepository.getYearLevelByNumber(student.yearLevel, tx);
            const sec = yl ? await AcademicRepository.getSectionByName(student.section, yl.id, undefined, undefined, tx) : null;
            await AcademicRepository.createEnrollment({
              id: `enr_${student.id}_${activeSem.id}`,
              student_id: student.id,
              semester_id: activeSem.id,
              program_id: student.course ? `prog_${student.course.toLowerCase()}` : 'prog_bsit',
              year_level: student.yearLevel,
              section: student.section,
              year_level_id: yl?.id || null,
              section_id: sec?.id || null,
              enrollment_status: 'ENROLLED',
              first_name_snapshot: student.firstName,
              middle_name_snapshot: student.middleName || null,
              last_name_snapshot: student.lastName,
              updated_at: now,
            }, tx);
          }
        }

        // NFC Card mapping
        if (student.rfidUid) {
          const normUid = student.rfidUid.trim().toUpperCase();
          // Deactivate prior active card for this student
          await tx.execute(
            `UPDATE nfc_cards SET status = 'REPLACED', revoked_at = ? WHERE student_id = ? AND status = 'ACTIVE'`,
            [now, student.id]
          );
          const existingCard = await tx.queryOne<{ id: string }>(
            `SELECT id FROM nfc_cards WHERE uid_normalized = ? LIMIT 1`,
            [normUid]
          );
          if (existingCard) {
            await tx.execute(
              `UPDATE nfc_cards SET student_id = ?, status = 'ACTIVE', assigned_at = ?, revoked_at = NULL WHERE id = ?`,
              [student.id, now, existingCard.id]
            );
          } else {
            await tx.execute(
              `INSERT INTO nfc_cards (id, student_id, uid_normalized, status, assigned_at)
               VALUES (?, ?, ?, 'ACTIVE', ?)`,
              [`crd_${student.id}_${Date.now()}`, student.id, normUid, now]
            );
          }
        }
      });
    } catch (err) {
      console.warn('[LocalStudentRepository] Failed saving student to SQLite:', err);
    }

    // Mirror to legacy Preferences for backward compatibility
    try {
      const { value } = await Preferences.get({ key: STUDENTS_STORAGE_KEY });
      let records: Student[] = value ? JSON.parse(value) : [];
      if (!Array.isArray(records)) records = [];
      const idx = records.findIndex(s => s.id === student.id);
      if (idx >= 0) {
        records[idx] = { ...student, updatedAt: now };
      } else {
        records.unshift(student);
      }
      await Preferences.set({ key: STUDENTS_STORAGE_KEY, value: JSON.stringify(records) });
    } catch (err) {
      console.warn('[LocalStudentRepository] Failed mirroring to Preferences:', err);
    }

    return student;
  }

  async delete(id: string): Promise<void> {
    this.clearCache();
    const now = new Date().toISOString();
    try {
      const db = await getDatabase();
      await db.execute('UPDATE students SET deleted_at = ?, status = "INACTIVE" WHERE id = ?', [now, id]);
    } catch (err) {
      console.warn('[LocalStudentRepository] Failed deleting student from SQLite:', err);
    }

    try {
      const { value } = await Preferences.get({ key: STUDENTS_STORAGE_KEY });
      let records: Student[] = value ? JSON.parse(value) : [];
      if (Array.isArray(records)) {
        records = records.filter(s => s.id !== id);
        await Preferences.set({ key: STUDENTS_STORAGE_KEY, value: JSON.stringify(records) });
      }
    } catch (err) {
      console.warn('[LocalStudentRepository] Failed deleting from Preferences:', err);
    }
  }

  async saveAll(students: Student[]): Promise<void> {
    this.clearCache();
    for (const student of students) {
      await this.save(student);
    }
  }

  private mapSqliteToStudent(r: StudentWithEnrollment): Student {
    let course = 'BSIT';
    if (r.program_id) {
      course = r.program_id.startsWith('prog_')
        ? r.program_id.replace('prog_', '').toUpperCase()
        : r.program_id;
    }
    const rfidUid = r.card_uid || null;
    const rfidCompact = rfidUid ? rfidUid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null;

    const cards: NfcCardRecord[] = [];
    if (rfidUid) {
      cards.push({
        id: `card_${r.id}_${rfidCompact || 'init'}`,
        studentId: r.id,
        rfidUid: rfidUid,
        rfidUidCompact: rfidCompact || '',
        status: (r.card_status as NfcCardStatus) || 'ACTIVE',
        assignedAt: r.created_at || new Date().toISOString(),
      });
    }

    return {
      id: r.id,
      studentNumber: r.school_id,
      firstName: r.first_name,
      middleName: r.middle_name || undefined,
      lastName: r.last_name,
      yearLevel: ((r.year_level && r.year_level >= 1 && r.year_level <= 4) ? r.year_level : 1) as YearLevel,
      section: r.section || '',
      course,
      status: (r.status as StudentStatus) || 'ACTIVE',
      rfidUid,
      rfidUidCompact: rfidCompact,
      cards,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private normalizeLegacyStudent(student: Student): Student {
    const s = { ...student };
    if (!s.status) {
      s.status = 'ACTIVE';
    }
    if (!s.cards) {
      s.cards = [];
      if (s.rfidUid) {
        const card: NfcCardRecord = {
          id: 'card_' + s.id + '_init',
          studentId: s.id,
          rfidUid: s.rfidUid,
          rfidUidCompact: s.rfidUidCompact || s.rfidUid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase(),
          status: 'ACTIVE',
          assignedAt: s.createdAt || new Date().toISOString(),
        };
        s.cards.push(card);
      }
    }
    return s;
  }

  private async migrateToSqlite(students: Student[]): Promise<void> {
    try {
      const db = await getDatabase();
      const activeSem = await AcademicRepository.getActiveSemester();
      const now = new Date().toISOString();

      await db.transaction(async (tx) => {
        for (const s of students) {
          const existing = await StudentsRepository.getStudentById(s.id, tx);
          if (!existing) {
            await StudentsRepository.createStudent(
              {
                id: s.id,
                school_id: s.studentNumber || `LEGACY-${s.id}`,
                first_name: s.firstName,
                middle_name: s.middleName || null,
                last_name: s.lastName,
                status: s.status || 'ACTIVE',
                created_at: s.createdAt || now,
                updated_at: s.updatedAt || now,
              },
              tx
            );

            if (activeSem) {
              const yl = await AcademicRepository.getYearLevelByNumber(s.yearLevel, tx);
              const sec = yl ? await AcademicRepository.getSectionByName(s.section, yl.id, undefined, undefined, tx) : null;
              await AcademicRepository.createEnrollment(
                {
                  id: `enr_${s.id}_${activeSem.id}`,
                  student_id: s.id,
                  semester_id: activeSem.id,
                  program_id: s.course ? `prog_${s.course.toLowerCase()}` : 'prog_bsit',
                  year_level: s.yearLevel,
                  section: s.section,
                  year_level_id: yl?.id || null,
                  section_id: sec?.id || null,
                  enrollment_status: 'ENROLLED',
                  first_name_snapshot: s.firstName,
                  middle_name_snapshot: s.middleName || null,
                  last_name_snapshot: s.lastName,
                  updated_at: now,
                },
                tx
              );
            }

            if (s.rfidUid) {
              const normUid = s.rfidUid.trim().toUpperCase();
              const existingCard = await tx.queryOne<{ id: string }>(
                `SELECT id FROM nfc_cards WHERE uid_normalized = ? AND status = 'ACTIVE' LIMIT 1`,
                [normUid]
              );
              if (!existingCard) {
                await tx.execute(
                  `INSERT INTO nfc_cards (id, student_id, uid_normalized, status, assigned_at)
                   VALUES (?, ?, ?, 'ACTIVE', ?)`,
                  [`crd_${s.id}_init`, s.id, normUid, s.createdAt || now]
                );
              }
            }
          }
        }
      });
    } catch (err) {
      console.warn('[LocalStudentRepository] Migration to SQLite error:', err);
    }
  }
}

export const localStudentRepository = new LocalStudentRepository();
