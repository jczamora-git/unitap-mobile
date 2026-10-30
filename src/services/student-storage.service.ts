import { Preferences } from '@capacitor/preferences';
import type { Student, NfcCardRecord } from '@/types/student';

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

      // Backward compatibility normalization:
      // Ensure cards array exists if student has rfidUid
      const normalized = records.map(student => {
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
              assignedAt: s.createdAt || new Date().toISOString()
            };
            s.cards.push(card);
          }
        }
        return s;
      });

      this.cache = normalized;
      return [...this.cache];
    } catch (err) {
      console.error('Error loading students from storage:', err);
      this.cache = [];
      return [];
    }
  }

  async getById(id: string): Promise<Student | null> {
    const students = await this.getAll();
    return students.find(s => s.id === id) || null;
  }

  async getByStudentNumber(studentNumber: string): Promise<Student | null> {
    if (!studentNumber || !studentNumber.trim()) return null;
    const cleanNum = studentNumber.trim().toLowerCase();
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

        // Fallback to legacy fields if cards not yet checked
        if (!s.rfidUid) return false;
        const studentUid = s.rfidUid.trim().toUpperCase();
        const studentCompact = (s.rfidUidCompact || studentUid).replace(/[^0-9A-F]/g, '');
        return studentUid === cleanUid || studentCompact === compactUid;
      }) || null
    );
  }

  async save(student: Student): Promise<Student> {
    const students = await this.getAll();
    const index = students.findIndex(s => s.id === student.id);

    if (index >= 0) {
      students[index] = { ...student, updatedAt: new Date().toISOString() };
    } else {
      students.unshift(student);
    }

    this.cache = students;
    await this.persist(students);
    return student;
  }

  async delete(id: string): Promise<void> {
    const students = await this.getAll();
    const filtered = students.filter(s => s.id !== id);
    this.cache = filtered;
    await this.persist(filtered);
  }

  async saveAll(students: Student[]): Promise<void> {
    this.cache = [...students];
    await this.persist(students);
  }

  private async persist(students: Student[]): Promise<void> {
    const jsonStr = JSON.stringify(students);
    try {
      await Preferences.set({ key: STUDENTS_STORAGE_KEY, value: jsonStr });
    } catch (err) {
      console.error('Failed to persist students:', err);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(STUDENTS_STORAGE_KEY, jsonStr);
        }
      } catch {
        // Ignore
      }
    }
  }
}

export const localStudentRepository = new LocalStudentRepository();
