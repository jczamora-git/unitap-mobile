import { describe, it, expect, beforeEach } from 'vitest';
import { StudentService } from '@/services/student.service';
import type { IStudentRepository } from '@/services/student-storage.service';
import type { Student } from '@/types/student';

class MockStudentRepo implements IStudentRepository {
  private store: Student[] = [];

  async getAll(): Promise<Student[]> {
    return [...this.store];
  }
  async getById(id: string): Promise<Student | null> {
    return this.store.find(s => s.id === id) || null;
  }
  async getByStudentNumber(num: string): Promise<Student | null> {
    return this.store.find(s => s.studentNumber?.toLowerCase() === num.toLowerCase()) || null;
  }
  async getByRfid(rfid: string): Promise<Student | null> {
    const clean = rfid.trim().toUpperCase();
    return this.store.find(s => {
      const activeCard = s.cards?.find(c => c.status === 'ACTIVE');
      if (activeCard && activeCard.rfidUid.toUpperCase() === clean) return true;
      return s.rfidUid?.toUpperCase() === clean;
    }) || null;
  }
  async save(student: Student): Promise<Student> {
    const idx = this.store.findIndex(s => s.id === student.id);
    if (idx >= 0) this.store[idx] = student;
    else this.store.push(student);
    return student;
  }
  async delete(id: string): Promise<void> {
    this.store = this.store.filter(s => s.id !== id);
  }
  async saveAll(students: Student[]): Promise<void> {
    this.store = [...students];
  }
  clearCache(): void {}
}

describe('StudentService', () => {
  let repo: MockStudentRepo;
  let service: StudentService;

  beforeEach(() => {
    repo = new MockStudentRepo();
    service = new StudentService(repo);
  });

  it('creates a valid student and assigns active NFC card', async () => {
    const student = await service.createStudent({
      studentNumber: '2023-00001',
      firstName: 'Alice',
      lastName: 'Guo',
      yearLevel: 2,
      section: 'BSIT-2A',
      course: 'BSIT',
      rfidUid: '04:A1:B2:C3:D4:E5:F6'
    });

    expect(student.id).toBeDefined();
    expect(student.studentNumber).toBe('2023-00001');
    expect(student.cards).toHaveLength(1);
    expect(student.cards?.[0].status).toBe('ACTIVE');
    expect(student.cards?.[0].rfidUid).toBe('04:A1:B2:C3:D4:E5:F6');
  });

  it('rejects duplicate student numbers', async () => {
    await service.createStudent({
      studentNumber: '2023-00001',
      firstName: 'Alice',
      lastName: 'Guo',
      yearLevel: 2,
      section: 'BSIT-2A'
    });

    await expect(service.createStudent({
      studentNumber: '2023-00001',
      firstName: 'Bob',
      lastName: 'Smith',
      yearLevel: 3,
      section: 'BSIT-3A'
    })).rejects.toThrow('already in use');
  });

  it('rejects duplicate active RFID UID', async () => {
    await service.createStudent({
      studentNumber: '2023-00001',
      firstName: 'Alice',
      lastName: 'Guo',
      yearLevel: 2,
      section: 'BSIT-2A',
      rfidUid: '04:A1:B2:C3:D4:E5:F6'
    });

    await expect(service.createStudent({
      studentNumber: '2023-00002',
      firstName: 'Bob',
      lastName: 'Smith',
      yearLevel: 3,
      section: 'BSIT-3A',
      rfidUid: '04:A1:B2:C3:D4:E5:F6'
    })).rejects.toThrow('already registered');
  });

  it('replaces NFC card while preserving card history', async () => {
    const student = await service.createStudent({
      studentNumber: '2023-00001',
      firstName: 'Alice',
      lastName: 'Guo',
      yearLevel: 2,
      section: 'BSIT-2A',
      rfidUid: 'CARD_1'
    });

    const updated = await service.replaceStudentRfid(student.id, 'CARD_2', undefined, 'Replaced lost card');
    expect(updated.rfidUid).toBe('CARD_2');
    expect(updated.cards).toHaveLength(2);

    const oldCard = updated.cards?.find(c => c.rfidUid === 'CARD_1');
    const newCard = updated.cards?.find(c => c.rfidUid === 'CARD_2');
    expect(oldCard?.status).toBe('REPLACED');
    expect(newCard?.status).toBe('ACTIVE');
  });

  it('correctly looks up active, inactive/replaced, and unregistered cards', async () => {
    const student = await service.createStudent({
      studentNumber: '2023-00001',
      firstName: 'Alice',
      lastName: 'Guo',
      yearLevel: 2,
      section: 'BSIT-2A',
      rfidUid: '04:A1:B2:C3'
    });

    // 1. Check active card
    const activeResult = await service.lookupCard('04:A1:B2:C3');
    expect(activeResult.status).toBe('ACTIVE');
    expect(activeResult.student?.id).toBe(student.id);
    expect(activeResult.maskedUid).toBe('04:••:••:C3');

    // 2. Replace card with new one
    await service.replaceStudentRfid(student.id, '04:D4:E5:F6', undefined, 'Card upgrade');

    // 3. Old card should now lookup as REPLACED, still linked to student
    const oldCardResult = await service.lookupCard('04:A1:B2:C3');
    expect(oldCardResult.status).toBe('REPLACED');
    expect(oldCardResult.student?.id).toBe(student.id);

    // 4. New card is active
    const newCardResult = await service.lookupCard('04:D4:E5:F6');
    expect(newCardResult.status).toBe('ACTIVE');
    expect(newCardResult.student?.id).toBe(student.id);

    // 5. Unknown card should lookup as UNREGISTERED
    const unknownResult = await service.lookupCard('FF:FF:FF:FF');
    expect(unknownResult.status).toBe('UNREGISTERED');
    expect(unknownResult.student).toBeNull();
  });
});
