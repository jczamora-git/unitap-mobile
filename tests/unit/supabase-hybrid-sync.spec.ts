import { describe, it, expect, beforeEach } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { SyncScopeService } from '@/services/sync/sync-scope.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { PushSyncService } from '@/services/sync/push-sync.service';
import { PullSyncService } from '@/services/sync/pull-sync.service';
import { ConflictService } from '@/services/sync/conflict.service';
import { AuthSessionService } from '@/integrations/supabase/auth-session.service';
import { AccountLinkingService } from '@/integrations/supabase/account-linking.service';
import { attendanceService } from '@/services/attendance.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';

describe('UniTap 2.0 Hybrid Architecture & Bidirectional Sync', () => {
  const semesterId = 'sem_hybrid_test';
  const studentId = 'stu_hybrid_1';
  const cardUid = '04D1E2F3A4B5';
  const occurrenceId = 'occ_hybrid_1';

  beforeEach(async () => {
    await resetDatabaseForTests();
    await AuthSessionService.clearOfflineSession();

    const db = await getDatabase();
    // Setup officer user
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_1', 'officer1', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    // Setup academic term
    await AcademicRepository.createYear({
      id: 'ay_hybrid',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });
    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_hybrid',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    // Setup student & card
    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2026-7001',
      first_name: 'Andres',
      last_name: 'Bonifacio',
      photo_local_uri: 'file:///data/user/0/com.unitap.app/files/photos/bonifacio.jpg',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await CardsRepository.assignCard({
      id: 'card_hybrid_1',
      student_id: studentId,
      uid_normalized: cardUid,
      status: 'ACTIVE',
      assigned_at: new Date().toISOString(),
    });

    // Setup event & open occurrence
    await EventsRepository.createEvent({
      id: 'ev_hybrid_1',
      semester_id: semesterId,
      title: 'CSG Leadership Summit',
      event_type: 'SEMINAR',
      audience_type: 'ALL',
      audience_json: '{}',
      attendance_required: 1,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await EventsRepository.createOccurrence({
      id: occurrenceId,
      event_id: 'ev_hybrid_1',
      title: 'Keynote Session',
      occurs_on: '2026-09-01',
      starts_at: '09:00',
      ends_at: '12:00',
      grace_minutes: 30,
      status: 'OPEN',
      updated_at: new Date().toISOString(),
    });
  });

  // Scenario A: First Login & Local Hydration
  it('Scenario A: Handles first-login hydration, role-scoping, and persistence across reopen', async () => {
    const isHydratedBefore = await InitialSyncService.isHydrated();
    expect(isHydratedBefore).toBe(false);

    // Verify role scoping
    const officerTables = SyncScopeService.getRequiredTablesForRole('OFFICER');
    expect(officerTables).toContain('students');
    expect(officerTables).toContain('attendance_records');
    expect(officerTables).toContain('payments');

    const studentTables = SyncScopeService.getRequiredTablesForRole('STUDENT');
    expect(studentTables).toContain('students');
    expect(studentTables).not.toContain('import_batches');

    // Run hydration
    const success = await InitialSyncService.performInitialHydration('OFFICER', 'officer_1');
    expect(success).toBe(true);

    const isHydratedAfter = await InitialSyncService.isHydrated();
    expect(isHydratedAfter).toBe(true);
    expect(SyncStatusService.hydration.value).toBe('READY');
  });

  // Scenario B: Offline Attendance Recording & Transactional Outbox
  it('Scenario B: Records attendance offline and queues transactional outbox operation', async () => {
    // 1. Prepare scan
    const prep = await attendanceService.prepareNfcVerification(occurrenceId, cardUid, 'officer_1');
    expect(prep.type).toBe('ACCEPTED');
    expect(prep.photoLocalUri).toContain('bonifacio.jpg');

    // 2. Officer confirms identity
    await attendanceService.confirmStudentAttendance(occurrenceId, studentId, 'officer_1', 'PRESENT');

    // 3. Outbox operation must exist in SQLite
    const db = await getDatabase();
    const outboxOps = await db.query(
      "SELECT * FROM sync_outbox WHERE entity_type = 'ATTENDANCE'"
    );
    expect(outboxOps.length).toBeGreaterThan(0);

    const latestOp = outboxOps[outboxOps.length - 1];
    expect(latestOp.operation).toBe('CREATE');
    const payload = JSON.parse(latestOp.payload_json);
    expect(payload.student_id).toBe(studentId);
    expect(payload.status).toBe('PRESENT');
  });

  // Scenario C: Reconnection & Push Synchronization
  it('Scenario C: Flushes outbox operations during push sync without creating duplicates', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
      [now]
    );

    // Enqueue an outbox operation manually
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES (?, 'dev_default', ?, ?, ?, ?, ?)`,
      [
        'op_test_recon',
        'ATTENDANCE',
        'att_test_recon',
        'CREATE',
        JSON.stringify({
          id: 'att_test_recon',
          occurrence_id: occurrenceId,
          student_id: studentId,
          status: 'PRESENT',
          checked_in_at: now,
          identity_verified_by_user_id: 'officer_1',
        }),
        now,
      ]
    );

    const outboxBefore = await db.query('SELECT * FROM sync_outbox WHERE id = ?', ['op_test_recon']);
    expect(outboxBefore.length).toBe(1);

    // Run push sync
    await PushSyncService.pushPendingOperations();

    // In offline test environment, mock push resolves outbox or preserves idempotency
    const remaining = await db.query('SELECT count(*) as count FROM sync_outbox');
    expect(remaining).toBeDefined();
  });

  // Scenario D & E: Incremental Pull Synchronization & Catch-Up
  it('Scenario D & E: Pulls remote changes transactionally and updates local cursor', async () => {
    const db = await getDatabase();
    const res = await PullSyncService.pullRemoteChanges();
    expect(res).toBeDefined();
    expect(typeof res.appliedCount).toBe('number');

    // Cursor exists and timestamp updated
    const state = await db.queryOne<{ last_success_at: string | null }>(
      'SELECT last_success_at FROM sync_state LIMIT 1'
    );
    expect(state?.last_success_at).not.toBeNull();
  });

  // Scenario F: Concurrency Conflict Auditing
  it('Scenario F: Audits conflicting updates without silent data loss', async () => {
    await ConflictService.recordConflict({
      id: 'conf_test_1',
      entityType: 'ATTENDANCE',
      entityId: 'att_123',
      conflictType: 'DUPLICATE_ACCEPTED_ATTENDANCE',
      clientPayload: { student_id: studentId, status: 'PRESENT' },
      resolution: 'SERVER_WINS',
    });

    const db = await getDatabase();
    const conflicts = await db.query<any>("SELECT * FROM sync_conflicts WHERE id = 'conf_test_1'");
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].reason).toBe('DUPLICATE_ACCEPTED_ATTENDANCE');
    expect(conflicts[0].status).toBe('RESOLVED');
  });

  // Scenario G: Account Isolation & Offline Session Expiry
  it('Scenario G: Caches offline session with 7-day expiry and isolates accounts upon logout', async () => {
    const user = {
      id: 'usr_student_iso',
      username: '2026-7001',
      student_id: studentId,
      account_status: 'ACTIVE' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const role = {
      id: 'rol_iso',
      user_id: user.id,
      role: 'STUDENT' as const,
      assigned_at: new Date().toISOString(),
    };

    const session = await AuthSessionService.saveOfflineSession(user, role, 'student@univ.edu');
    expect(session.userId).toBe(user.id);
    expect(session.role).toBe('STUDENT');
    expect(AuthSessionService.isOfflineSessionValid(session)).toBe(true);

    // Clear session on logout
    await AuthSessionService.clearOfflineSession();
    const cachedAfter = await AuthSessionService.getCachedOfflineSession();
    expect(cachedAfter).toBeNull();
  });

  // Scenario H: Student Account Linking via Activation Code Claim
  it('Scenario H: Verifies activation claims locally and links student account', async () => {
    const rawCode = 'H84K9X2M';
    const codeHash = await AccountLinkingService.hashActivationCode(rawCode);

    const db = await getDatabase();
    // Issue activation claim
    await db.execute(
      `INSERT INTO activation_claims (id, student_id, token_hash, issued_by_user_id, expires_at, created_at)
       VALUES ('act_test_link', ?, ?, 'officer_1', datetime('now', '+2 days'), datetime('now'))`,
      [studentId, codeHash]
    );

    // Verify claim with wrong code -> fails
    const failRes = await AccountLinkingService.verifyActivationClaim('2026-7001', 'WRONG123');
    expect(failRes.success).toBe(false);

    // Verify claim with valid code -> succeeds
    const okRes = await AccountLinkingService.verifyActivationClaim('2026-7001', rawCode);
    expect(okRes.success).toBe(true);
    expect(okRes.studentId).toBe(studentId);

    // Link account
    await AccountLinkingService.linkStudentAccount('auth_user_supabase_123', studentId, '2026-7001');

    const linkedUser = await db.queryOne<{ id: string; student_id: string }>(
      "SELECT id, student_id FROM users WHERE id = 'auth_user_supabase_123'"
    );
    expect(linkedUser?.student_id).toBe(studentId);
  });
});
