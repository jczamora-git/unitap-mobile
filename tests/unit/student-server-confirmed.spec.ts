import { describe, it, expect, beforeEach } from 'vitest';
import { StudentService } from '@/services/student.service';
import type { IStudentRepository } from '@/services/student-storage.service';
import type { Student } from '@/types/student';
import { supabase } from '@/integrations/supabase/client';
import { OperationPolicyService } from '@/services/operation-policy.service';
import { PolicyViolationError } from '@/types/policy';

class MockStudentRepo implements IStudentRepository {
  private store: Student[] = [];

  async getAll(): Promise<Student[]> {
    return [...this.store];
  }
  async getById(id: string): Promise<Student | null> {
    return this.store.find((s) => s.id === id) || null;
  }
  async getByStudentNumber(num: string): Promise<Student | null> {
    return this.store.find((s) => s.studentNumber?.toLowerCase() === num.toLowerCase()) || null;
  }
  async getByRfid(rfid: string): Promise<Student | null> {
    const clean = rfid.trim().toUpperCase();
    return (
      this.store.find((s) => {
        const activeCard = s.cards?.find((c) => c.status === 'ACTIVE');
        if (activeCard && activeCard.rfidUid.toUpperCase() === clean) return true;
        return s.rfidUid?.toUpperCase() === clean;
      }) || null
    );
  }
  async save(student: Student): Promise<Student> {
    const idx = this.store.findIndex((s) => s.id === student.id);
    if (idx >= 0) this.store[idx] = student;
    else this.store.push(student);
    return student;
  }
  async delete(id: string): Promise<void> {
    this.store = this.store.filter((s) => s.id !== id);
  }
  async saveAll(students: Student[]): Promise<void> {
    this.store = [...students];
  }
  clearCache(): void {}
}

describe('Phase 2B: Server-Confirmed Student Management', () => {
  let repo: MockStudentRepo;
  let service: StudentService;
  let supabaseCalls: Array<{ table: string; method: string; payload?: any; filters?: any }>;

  beforeEach(() => {
    OperationPolicyService.setMockOfflineOverride(false);
    repo = new MockStudentRepo();
    service = new StudentService(repo);
    supabaseCalls = [];

    (supabase.from as any) = (tableName: string) => {
      const callRecord: { table: string; method: string; payload?: any; filters?: any } = {
        table: tableName,
        method: '',
      };

      const builder: any = {
        insert: async (data: any) => {
          callRecord.method = 'insert';
          callRecord.payload = data;
          supabaseCalls.push(callRecord);
          return { data, error: null };
        },
        update: (data: any) => {
          callRecord.method = 'update';
          callRecord.payload = data;
          return builder;
        },
        upsert: async (data: any) => {
          callRecord.method = 'upsert';
          callRecord.payload = data;
          supabaseCalls.push(callRecord);
          return { data, error: null };
        },
        delete: () => {
          callRecord.method = 'delete';
          return builder;
        },
        select: () => builder,
        eq: (col: string, val: any) => {
          callRecord.filters = { ...(callRecord.filters || {}), [col]: val };
          return builder;
        },
        ilike: (col: string, val: any) => {
          callRecord.filters = { ...(callRecord.filters || {}), [col]: val };
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
      };

      builder.then = (resolve: any) => {
        supabaseCalls.push(callRecord);
        resolve({ data: null, error: null });
      };

      return builder;
    };
  });

  // ============================================================================
  // 1. OFFLINE POLICY REJECTION (ONLINE_CONFIRMED)
  // ============================================================================

  it('rejects student creation when device is offline without touching Supabase or SQLite', async () => {
    OperationPolicyService.setMockOfflineOverride(true);

    await expect(
      service.createStudent({
        studentNumber: '2026-00001',
        firstName: 'Maria',
        lastName: 'Santos',
        yearLevel: 2,
        section: 'BSIT-2A',
      })
    ).rejects.toThrow(PolicyViolationError);

    expect(supabaseCalls).toHaveLength(0);
    const localStudents = await repo.getAll();
    expect(localStudents).toHaveLength(0);
  });

  it('rejects student updates when device is offline', async () => {
    const student = await service.createStudent({
      studentNumber: '2026-00001',
      firstName: 'Maria',
      lastName: 'Santos',
      yearLevel: 2,
      section: 'BSIT-2A',
    });

    OperationPolicyService.setMockOfflineOverride(true);

    await expect(
      service.updateStudent(student.id, { firstName: 'Maria Clara' })
    ).rejects.toThrow(PolicyViolationError);

    const check = await repo.getById(student.id);
    expect(check?.firstName).toBe('Maria');
  });

  it('rejects NFC card replacement when device is offline', async () => {
    const student = await service.createStudent({
      studentNumber: '2026-00001',
      firstName: 'Maria',
      lastName: 'Santos',
      yearLevel: 2,
      section: 'BSIT-2A',
      rfidUid: '04:A1:A2:A3:A4',
    });

    OperationPolicyService.setMockOfflineOverride(true);

    await expect(
      service.replaceStudentRfid(student.id, '04:B1:B2:B3:B4')
    ).rejects.toThrow(PolicyViolationError);
  });

  // ============================================================================
  // 2. SERVER CONFIRMATION FAIL-CLOSED (Supabase Rejection)
  // ============================================================================

  it('fails closed and does NOT save to local SQLite when Supabase rejects creation', async () => {
    // Configure Supabase to reject the insert
    (supabase.from as any) = (tableName: string) => {
      const builder: any = {
        insert: async () => ({
          data: null,
          error: { message: 'duplicate key value violates unique constraint "students_school_id_key"' },
        }),
      };
      return builder;
    };

    await expect(
      service.createStudent({
        studentNumber: '2026-00001',
        firstName: 'Duplicate',
        lastName: 'Student',
        yearLevel: 1,
        section: 'BSIT-1A',
      })
    ).rejects.toThrow('Server failed to create student');

    const all = await repo.getAll();
    expect(all).toHaveLength(0);
  });

  it('fails closed and does NOT mutate local SQLite when Supabase rejects update', async () => {
    const student = await service.createStudent({
      studentNumber: '2026-00001',
      firstName: 'Original',
      lastName: 'Student',
      yearLevel: 1,
      section: 'BSIT-1A',
    });

    // Make next update fail
    (supabase.from as any) = (tableName: string) => {
      const builder: any = {
        update: () => builder,
        eq: () => builder,
      };
      builder.then = (resolve: any) =>
        resolve({
          data: null,
          error: { message: 'permission denied for table students' },
        });
      return builder;
    };

    await expect(
      service.updateStudent(student.id, { firstName: 'Hacked' })
    ).rejects.toThrow('Server failed to update student');

    const check = await repo.getById(student.id);
    expect(check?.firstName).toBe('Original');
  });

  // ============================================================================
  // 3. SUCCESSFUL SERVER-CONFIRMED STUDENT MUTATIONS
  // ============================================================================

  it('successfully creates student on server and commits to local SQLite repository', async () => {
    const created = await service.createStudent({
      studentNumber: '2026-00100',
      firstName: 'Juan',
      middleName: 'Protacio',
      lastName: 'Rizal',
      yearLevel: 3,
      section: 'BSIT-3A',
      course: 'BSIT',
      rfidUid: '04:11:22:33:44:55',
    });

    expect(created.id).toBeDefined();
    expect(created.firstName).toBe('Juan');
    expect(created.cards).toHaveLength(1);
    expect(created.cards?.[0].status).toBe('ACTIVE');

    // Verify Supabase was called for students table
    const studentInsert = supabaseCalls.find((c) => c.table === 'students' && c.method === 'insert');
    expect(studentInsert).toBeDefined();
    expect(studentInsert?.payload.first_name).toBe('Juan');
    expect(studentInsert?.payload.last_name).toBe('Rizal');

    // Verify committed to local repository
    const stored = await repo.getById(created.id);
    expect(stored).not.toBeNull();
    expect(stored?.studentNumber).toBe('2026-00100');
  });

  it('successfully updates student on server and commits locally', async () => {
    const created = await service.createStudent({
      studentNumber: '2026-00200',
      firstName: 'Andres',
      lastName: 'Bonifacio',
      yearLevel: 2,
      section: 'BSIT-2B',
    });

    const updated = await service.updateStudent(created.id, {
      firstName: 'Andres Supremo',
      section: 'BSIT-3B',
      yearLevel: 3,
    });

    expect(updated.firstName).toBe('Andres Supremo');
    expect(updated.section).toBe('BSIT-3B');
    expect(updated.yearLevel).toBe(3);

    // Verify Supabase update call
    const studentUpdate = supabaseCalls.find((c) => c.table === 'students' && c.method === 'update');
    expect(studentUpdate).toBeDefined();
    expect(studentUpdate?.payload.first_name).toBe('Andres Supremo');

    const stored = await repo.getById(created.id);
    expect(stored?.firstName).toBe('Andres Supremo');
    expect(stored?.section).toBe('BSIT-3B');
  });

  it('deactivates student on server and updates local status to INACTIVE', async () => {
    const student = await service.createStudent({
      studentNumber: '2026-00300',
      firstName: 'Emilio',
      lastName: 'Aguinaldo',
      yearLevel: 4,
      section: 'BSIT-4A',
    });

    const deactivated = await service.deactivateStudent(student.id);
    expect(deactivated.status).toBe('INACTIVE');

    // Verify Supabase received status INACTIVE
    const deactCall = supabaseCalls.find(
      (c) => c.table === 'students' && c.method === 'update' && c.payload?.status === 'INACTIVE'
    );
    expect(deactCall).toBeDefined();

    const stored = await repo.getById(student.id);
    expect(stored?.status).toBe('INACTIVE');
  });

  it('replaces NFC card with server confirmation and maintains card history', async () => {
    const student = await service.createStudent({
      studentNumber: '2026-00400',
      firstName: 'Apolinario',
      lastName: 'Mabini',
      yearLevel: 1,
      section: 'BSIT-1A',
      rfidUid: '04:AA:BB:CC',
    });

    const updated = await service.replaceStudentRfid(
      student.id,
      '04:DD:EE:FF',
      undefined,
      'Card was upgraded'
    );

    expect(updated.rfidUid).toBe('04:DD:EE:FF');
    expect(updated.cards).toHaveLength(2);
    expect(updated.cards?.find((c) => c.rfidUid === '04:AA:BB:CC')?.status).toBe('REPLACED');
    expect(updated.cards?.find((c) => c.rfidUid === '04:DD:EE:FF')?.status).toBe('ACTIVE');

    // Verify Supabase calls for nfc_cards
    const cardReplacedCall = supabaseCalls.find(
      (c) => c.table === 'nfc_cards' && c.method === 'update' && c.payload?.status === 'REPLACED'
    );
    expect(cardReplacedCall).toBeDefined();

    const cardInsertCall = supabaseCalls.find(
      (c) => c.table === 'nfc_cards' && c.method === 'insert' && c.payload?.uid_normalized === '04:DD:EE:FF'
    );
    expect(cardInsertCall).toBeDefined();
  });

  it('deactivates NFC card with server confirmation', async () => {
    const student = await service.createStudent({
      studentNumber: '2026-00500',
      firstName: 'Melchora',
      lastName: 'Aquino',
      yearLevel: 2,
      section: 'BSIT-2A',
      rfidUid: '04:77:88:99',
    });

    const updated = await service.deactivateStudentRfid(student.id, 'Lost card');
    expect(updated.rfidUid).toBeNull();
    expect(updated.cards?.[0].status).toBe('DEACTIVATED');

    const cardDeactCall = supabaseCalls.find(
      (c) => c.table === 'nfc_cards' && c.method === 'update' && c.payload?.status === 'DEACTIVATED'
    );
    expect(cardDeactCall).toBeDefined();
  });

  // ============================================================================
  // 4. OFFLINE READ ISOLATION (100% Offline SQLite Cache Reads)
  // ============================================================================

  it('allows complete student directory reading while completely offline without Supabase calls', async () => {
    // Seed records in local repository
    await repo.save({
      id: 'stu_offline_1',
      studentNumber: '2026-10001',
      firstName: 'Offline',
      lastName: 'Student 1',
      yearLevel: 1,
      section: 'BSIT-1A',
      course: 'BSIT',
      status: 'ACTIVE',
      rfidUid: '04:C1:C2:C3:C4',
      rfidUidCompact: '04C1C2C3C4',
      cards: [
        {
          id: 'card_off_1',
          studentId: 'stu_offline_1',
          rfidUid: '04:C1:C2:C3:C4',
          rfidUidCompact: '04C1C2C3C4',
          status: 'ACTIVE',
          assignedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Simulate strict offline mode
    OperationPolicyService.setMockOfflineOverride(true);
    supabaseCalls = [];

    // All read methods must succeed 100% offline
    const all = await service.getStudents();
    expect(all).toHaveLength(1);

    const single = await service.getStudent('stu_offline_1');
    expect(single?.firstName).toBe('Offline');

    const byNum = await service.findStudentByStudentNumber('2026-10001');
    expect(byNum?.id).toBe('stu_offline_1');

    const byRfid = await service.findStudentByRfid('04:C1:C2:C3:C4');
    expect(byRfid?.id).toBe('stu_offline_1');

    const cardLookup = await service.lookupCard('04:C1:C2:C3:C4');
    expect(cardLookup.status).toBe('ACTIVE');
    expect(cardLookup.student?.id).toBe('stu_offline_1');

    const searchRes = await service.searchStudents('Offline');
    expect(searchRes).toHaveLength(1);

    // ZERO Supabase network calls were made
    expect(supabaseCalls).toHaveLength(0);
  });
});

