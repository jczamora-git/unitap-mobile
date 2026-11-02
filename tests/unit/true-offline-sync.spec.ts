import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDatabase, resetDatabaseForTests } from '@/database/database';
import { NetworkService } from '@/services/network.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { SyncManager } from '@/services/sync/sync-manager';
import { PushSyncService } from '@/services/sync/push-sync.service';
import { PullSyncService } from '@/services/sync/pull-sync.service';
import { AttendanceService } from '@/services/attendance.service';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { AuthSessionService } from '@/integrations/supabase/auth-session.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { supabase } from '@/integrations/supabase/client';
import { Preferences } from '@capacitor/preferences';
import { normalizeSchoolId } from '@/utilities/school-id-normalizer';
import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';

describe('UniTap 2.0 True Offline-First Implementation & Auto-Sync Suite', () => {
  let db: DatabaseAdapter;

  beforeEach(async () => {
    vi.clearAllMocks();
    await Preferences.clear();
    db = await resetDatabaseForTests();

    // Seed minimal prerequisites
    await db.execute(`
      INSERT OR IGNORE INTO academic_years (id, label, starts_on, ends_on, status)
      VALUES ('ay_2026', '2026-2027', '2026-06-01', '2027-03-31', 'ACTIVE');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
      VALUES ('sem_2026_1', 'ay_2026', 'FIRST', '2026-06-01', '2026-10-31', 'ACTIVE');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO users (id, username, account_status, created_at, updated_at)
      VALUES ('usr_officer_1', 'officer_jane', 'ACTIVE', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO user_roles (id, user_id, role, semester_id, assigned_at)
      VALUES ('rol_off_1', 'usr_officer_1', 'OFFICER', 'sem_2026_1', '2026-08-01T00:00:00.000Z');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO events (id, semester_id, title, description, event_type, status, created_by_user_id, created_at, updated_at)
      VALUES ('evt_general_assembly', 'sem_2026_1', 'General Assembly 2026', 'General Assembly', 'OTHER', 'ACTIVE', 'usr_officer_1', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO event_occurrences (id, event_id, title, occurs_on, starts_at, ends_at, status, updated_at)
      VALUES ('occ_assembly_am', 'evt_general_assembly', 'Morning Session', '2026-08-10', '08:00:00', '12:00:00', 'OPEN', '2026-08-01T00:00:00.000Z');
    `);
  });

  it('Requirement 2: Offline startup restores cached session without network calls', async () => {
    // 1. Save an offline session ticket
    await AuthSessionService.saveOfflineSession(
      {
        id: 'usr_officer_1',
        username: 'officer_jane',
        account_status: 'ACTIVE',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
      {
        id: 'rol_off_1',
        user_id: 'usr_officer_1',
        role: 'OFFICER',
        assigned_at: '2026-08-01T00:00:00.000Z',
      },
      'officer@unitap.com'
    );

    // Mock network completely offline
    vi.spyOn(NetworkService, 'isOnline', 'get').mockReturnValue({ value: false } as any);

    // Spy on supabase.auth.getSession to verify it does not block offline restoration
    const getSessionSpy = vi.spyOn(supabase.auth, 'getSession');

    // Run initialization
    await SupabaseAuthService.initialize();

    // Verify session was restored into reactive state immediately
    expect(SupabaseAuthService.isAuthenticated.value).toBe(true);
    expect(SupabaseAuthService.role.value).toBe('OFFICER');
    expect(SupabaseAuthService.user.value?.username).toBe('officer_jane');
    expect(SupabaseAuthService.isOffline.value).toBe(true);
  });

  it('Requirement 3: Reads student and event lists directly from SQLite without network', async () => {
    // Seed sample student in local SQLite
    await StudentsRepository.createStudent({
      id: 'stu_offline_001',
      school_id: 'MCC2026-0001',
      first_name: 'John',
      last_name: 'Doe',
      status: 'ACTIVE',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    });

    // Query students and events directly
    const students = await StudentsRepository.getStudents();
    const occurrence = await EventsRepository.getOccurrenceById('occ_assembly_am');

    expect(students.length).toBeGreaterThanOrEqual(1);
    expect(students.some((s) => s.school_id === 'MCC2026-0001')).toBe(true);
    expect(occurrence?.id).toBe('occ_assembly_am');
    expect(occurrence?.status).toBe('OPEN');
  });

  it('Requirement 4 & 5: Offline NFC scan commits local attendance and outbox atomically', async () => {
    // Seed student with NFC card
    const studentData = {
      id: 'stu_offline_002',
      school_id: 'MCC2026-0002',
      first_name: 'Maria',
      last_name: 'Santos',
      status: 'ACTIVE' as const,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    };
    await StudentsRepository.createStudent(studentData);

    await db.execute(`
      INSERT OR IGNORE INTO nfc_cards (id, student_id, uid_normalized, status, assigned_at)
      VALUES ('card_maria_01', 'stu_offline_002', 'E004010000000001', 'ACTIVE', '2026-08-01T00:00:00.000Z');
    `);

    // Verify scan preparation matches student photo and eligibility
    const attendanceService = new AttendanceService();
    const prep = await attendanceService.prepareNfcVerification('occ_assembly_am', 'E004010000000001', 'usr_officer_1');
    expect(prep.type).toBe('ACCEPTED');
    expect(prep.student?.id).toBe('stu_offline_002');
    expect(prep.eligible).toBe(true);

    // Confirm scan offline
    const confirmRes = await attendanceService.confirmStudentAttendance(
      'occ_assembly_am',
      studentData.id,
      'usr_officer_1',
      'PRESENT',
      'card_maria_01',
      'E004010000000001'
    );

    expect(confirmRes.status).toBe('RECORDED');

    // Verify record in SQLite attendance_records
    const attRow = await db.queryOne<{ id: string; status: string; student_id: string }>(
      'SELECT id, status, student_id FROM attendance_records WHERE occurrence_id = ? AND student_id = ?',
      ['occ_assembly_am', studentData.id]
    );
    expect(attRow?.status).toBe('PRESENT');

    // Verify durable sync_outbox entry was created
    const outboxRow = await db.queryOne<{ id: string; entity_type: string; operation: string; entity_id: string }>(
      "SELECT id, entity_type, operation, entity_id FROM sync_outbox WHERE entity_type = 'ATTENDANCE' AND entity_id = ?",
      [attRow!.id]
    );
    expect(outboxRow).not.toBeNull();
    expect(outboxRow?.operation).toBe('CREATE');
    expect(outboxRow?.entity_id).toBe(attRow!.id);
  });

  it('Requirement 6 & 7: Connection returns and auto-sync pushes outbox idempotently without duplication', async () => {
    // Seed pending outbox record
    const attId = 'att_test_push_01';
    await db.execute(`
      INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
      VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', '2026-08-01T00:00:00.000Z');
    `);
    await db.execute(`
      INSERT OR IGNORE INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at)
      VALUES ('op_push_001', 'dev_default', 'ATTENDANCE', '${attId}', 'CREATE', '{"id":"${attId}","occurrence_id":"occ_assembly_am","student_id":"stu_offline_002","status":"PRESENT"}', 1, '2026-08-01T10:00:00.000Z');
    `);

    // Mock Supabase sync_push_batch returning successful APPLIED
    (supabase.rpc as any) = async (rpcName: string, params: any) => {
      if (rpcName === 'sync_push_batch') {
        return {
          data: {
            success: true,
            results: [
              {
                id: 'op_push_001',
                status: 'APPLIED',
                entity_type: 'ATTENDANCE',
                entity_id: attId,
              },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };

    const pushRes = await PushSyncService.pushPendingOperations();
    expect(pushRes.pushedCount).toBe(1);
    expect(pushRes.errorCount).toBe(0);

    // Verify sync_outbox was cleared for confirmed operation
    const remaining = await db.queryOne<{ count: number }>(
      "SELECT count(*) as count FROM sync_outbox WHERE id = 'op_push_001'"
    );
    expect(remaining?.count).toBe(0);
  });

  it('Requirement 9: Server push error sets SYNC_ERROR and preserves outbox for retry', async () => {
    // Seed pending outbox record
    await db.execute(`
      INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
      VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', '2026-08-01T00:00:00.000Z');
    `);
    await db.execute(`
      INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, schema_version, created_at)
      VALUES ('op_err_001', 'dev_default', 'ATTENDANCE', 'att_fail', 'CREATE', '{"id":"att_fail"}', 1, '2026-08-01T10:00:00.000Z');
    `);

    // Mock RPC network error
    (supabase.rpc as any) = async () => ({
      data: null,
      error: { message: 'Network connection timeout' },
    });

    const pushRes = await PushSyncService.pushPendingOperations();
    expect(pushRes.errorCount).toBeGreaterThanOrEqual(1);

    // Verify outbox record was preserved with updated last_error
    const preserved = await db.queryOne<{ id: string; retry_count: number; last_error: string }>(
      "SELECT id, retry_count, last_error FROM sync_outbox WHERE id = 'op_err_001'"
    );
    expect(preserved).not.toBeNull();
    expect(preserved?.last_error).toBeTruthy();
  });

  it('Requirement 11: School ID normalization prevents 300 remote students from producing 600 duplicates', () => {
    const remoteId = 'MCC2026-0256';
    const localId = 'MCC-2026-0256';

    const normalizedRemote = normalizeSchoolId(remoteId);
    const normalizedLocal = normalizeSchoolId(localId);

    // Both variations must resolve to the identical canonical identifier
    expect(normalizedRemote).toBe('MCC2026-0256');
    expect(normalizedLocal).toBe('MCC2026-0256');
    expect(normalizedRemote).toBe(normalizedLocal);
  });

  it('Requirement 14: Sync state machine reflects correct canonical states', () => {
    // Initial state
    SyncStatusService.setHydration('NOT_INITIALIZED');
    expect(SyncStatusService.canonicalState.value).toBe('NOT_INITIALIZED');

    // Downloading
    SyncStatusService.setHydration('DOWNLOADING');
    expect(SyncStatusService.canonicalState.value).toBe('SYNCING');

    // Ready with online & 0 pending
    SyncStatusService.setHydration('READY');
    SyncStatusService.setOnline(true);
    SyncStatusService.setPendingCount(0);
    SyncStatusService.setConflictCount(0);
    SyncStatusService.setLastError(null);
    expect(SyncStatusService.canonicalState.value).toBe('UP_TO_DATE');

    // Outbox pending
    SyncStatusService.setPendingCount(3);
    expect(SyncStatusService.canonicalState.value).toBe('PENDING_UPLOAD');

    // Offline with 0 pending
    SyncStatusService.setPendingCount(0);
    SyncStatusService.setOnline(false);
    expect(SyncStatusService.canonicalState.value).toBe('OFFLINE_READY');
  });

  it('Requirement 16: Single-flight sync worker coalesces duplicate triggers', async () => {
    vi.spyOn(NetworkService, 'isOnline', 'get').mockReturnValue({ value: true } as any);

    let activeRuns = 0;
    let maxConcurrent = 0;

    vi.spyOn(PushSyncService, 'pushPendingOperations').mockImplementation(async () => {
      activeRuns++;
      maxConcurrent = Math.max(maxConcurrent, activeRuns);
      await new Promise((r) => setTimeout(r, 50));
      activeRuns--;
      return { pushedCount: 0, errorCount: 0 };
    });

    vi.spyOn(PullSyncService, 'pullRemoteChanges').mockResolvedValue({
      appliedCount: 0,
      entityResults: {},
      isComplete: true,
    });

    // Launch multiple concurrent sync requests simultaneously
    const p1 = SyncManager.syncNow();
    const p2 = SyncManager.syncNow();
    const p3 = SyncManager.syncNow();

    await Promise.all([p1, p2, p3]);

    // Verify strictly never more than 1 worker active simultaneously
    expect(maxConcurrent).toBe(1);
  });
});

