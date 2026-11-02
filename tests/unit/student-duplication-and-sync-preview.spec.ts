import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import {
  normalizeSchoolId,
  areSchoolIdsEquivalent,
  getSchoolIdVariants,
} from '@/utilities/school-id-normalizer';
import {
  PullReconciliationService,
  type ProposedStudentOperation,
} from '@/services/sync/pull-reconciliation.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { SchemaMapperService } from '@/services/sync/schema-mapper.service';
import { EntityCheckpointService } from '@/services/sync/entity-checkpoint.service';
import { AccountLinkingService } from '@/integrations/supabase/account-linking.service';

describe('UniTap 2.0 Student Duplication & Sync Preview Suite', { timeout: 35000 }, () => {
  let pg: PGlite;

  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  // ---------------------------------------------------------------------------
  // PART 2: Canonical School ID Normalization Tests
  // ---------------------------------------------------------------------------
  it('Normalizes MCC format with hyphens, spaces, or lowercase to canonical MCCYYYY-SEQ', () => {
    expect(normalizeSchoolId('MCC-2026-0256')).toBe('MCC2026-0256');
    expect(normalizeSchoolId('mcc-2026-0256')).toBe('MCC2026-0256');
    expect(normalizeSchoolId('MCC2026-0256')).toBe('MCC2026-0256');
    expect(normalizeSchoolId('MCC 2026 0256')).toBe('MCC2026-0256');
    expect(normalizeSchoolId('  MCC_2026_0256  ')).toBe('MCC2026-0256');
    expect(normalizeSchoolId('MCC20260256')).toBe('MCC2026-0256');

    // Equivalence check
    expect(areSchoolIdsEquivalent('MCC-2026-0256', 'MCC2026-0256')).toBe(true);
    expect(areSchoolIdsEquivalent('mcc-2026-0256', 'MCC 2026 0256')).toBe(true);
    expect(areSchoolIdsEquivalent('MCC-2026-0256', 'MCC-2026-0288')).toBe(false);

    // Variants for lookup
    const variants = getSchoolIdVariants('MCC2026-0256');
    expect(variants).toContain('MCC2026-0256');
    expect(variants).toContain('MCC-2026-0256');
  });

  it('Preserves non-MCC institutions without mangling unrelated identifiers', () => {
    expect(normalizeSchoolId('UST-2025-12345')).toBe('UST-2025-12345');
    expect(normalizeSchoolId('CS-2026-0001')).toBe('CS-2026-0001');
    expect(areSchoolIdsEquivalent('UST-2025-12345', 'UST-2025-12345')).toBe(true);
    expect(areSchoolIdsEquivalent('UST-2025-12345', 'UST-2025-99999')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // PART 1 & 3: Pull Reconciliation Engine Analysis (Scenario 1 & 2: 300 Remote + 300 Local)
  // ---------------------------------------------------------------------------
  it('Scenario 1 & 2: 300 remote students + 300 local records with alternate-format School IDs classify as IDENTITY_MATCH_REVIEW, not duplicate INSERTs', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Seed 300 local students with alternate format 'MCC-2026-xxxx' and client UUIDs
    await db.transaction(async (tx) => {
      for (let i = 1; i <= 300; i++) {
        const seq = String(i).padStart(4, '0');
        await tx.execute(
          `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)`,
          [`local_uuid_${seq}`, `MCC-2026-${seq}`, `StudentFirst_${i}`, `StudentLast_${i}`, now, now]
        );
      }
    });

    const initialLocalCount = (await db.queryOne<{ count: number }>('SELECT count(*) as count FROM students'))?.count;
    expect(initialLocalCount).toBe(300);

    // Prepare 300 remote incoming records with canonical format 'MCC2026-xxxx' and server UUIDs
    const remoteRecords = [];
    for (let i = 1; i <= 300; i++) {
      const seq = String(i).padStart(4, '0');
      remoteRecords.push({
        id: `00000000-0000-4000-8000-${seq.padStart(12, '0')}`,
        school_id: `MCC2026-${seq}`,
        first_name: `StudentFirst_${i}`,
        last_name: `StudentLast_${i}`,
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      });
    }

    // Run preflight analysis
    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);

    // MUST NOT classify as INSERT!
    expect(summary.toInsert).toBe(0);
    expect(summary.identityMatches).toBe(300);
    expect(summary.conflicts).toBe(0);
    expect(operations.length).toBe(300);
    expect(operations[0].action).toBe('IDENTITY_MATCH_REVIEW');
    expect(operations[0].localId).toBe('local_uuid_0001');
    expect(operations[0].remoteId).toBe('00000000-0000-4000-8000-000000000001');

    // Apply the plan
    const plan = await PullReconciliationService.generatePreviewPlan(remoteRecords);
    const result = await PullReconciliationService.applyApprovedPlan(plan, db);

    expect(result.success).toBe(true);
    expect(result.reconciledIdentityCount).toBe(300);

    // Verification: The SQLite student count MUST REMAIN 300, NEVER 600!
    const finalLocalCount = (await db.queryOne<{ count: number }>('SELECT count(*) as count FROM students'))?.count;
    expect(finalLocalCount).toBe(300);

    // Authoritative remote UUIDs and canonical School IDs must be preserved
    const sample = await db.queryOne<{ id: string; school_id: string }>(
      'SELECT id, school_id FROM students WHERE school_id = "MCC2026-0001"'
    );
    expect(sample?.id).toBe('00000000-0000-4000-8000-000000000001');
  });

  // ---------------------------------------------------------------------------
  // Scenarios 3, 4, 5, 6, 7, 8, 9: Reconciliation Action Classification
  // ---------------------------------------------------------------------------
  it('Scenario 3: Same UUID and changed fields classifies as UPDATE', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const uuid = '11111111-1111-4111-8111-111111111111';

    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES (?, 'MCC2026-0100', 'John', 'Doe', 'ACTIVE', ?, ?)`,
      [uuid, now, now]
    );

    const remoteRecords = [
      {
        id: uuid,
        school_id: 'MCC2026-0100',
        first_name: 'Jonathan', // Changed field
        last_name: 'Doe',
        status: 'ACTIVE',
        updated_at: now,
      },
    ];

    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);
    expect(summary.toUpdate).toBe(1);
    expect(operations[0].action).toBe('UPDATE');
    expect(operations[0].fieldDifferences.some((d) => d.field === 'first_name')).toBe(true);
  });

  it('Scenario 4: Same canonical School ID and different UUID classifies as IDENTITY_MATCH_REVIEW', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const localId = 'client_local_id_999';
    const remoteId = '99999999-9999-4999-8999-999999999999';

    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES (?, 'MCC-2026-0999', 'Alice', 'Smith', 'ACTIVE', ?, ?)`,
      [localId, now, now]
    );

    const remoteRecords = [
      {
        id: remoteId,
        school_id: 'MCC2026-0999',
        first_name: 'Alice',
        last_name: 'Smith',
        status: 'ACTIVE',
        updated_at: now,
      },
    ];

    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);
    expect(summary.identityMatches).toBe(1);
    expect(operations[0].action).toBe('IDENTITY_MATCH_REVIEW');
    expect(operations[0].localId).toBe(localId);
  });

  it('Scenario 5: Same UUID and identical values classifies as UNCHANGED without unnecessary SQLite writes', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const uuid = '22222222-2222-4222-8222-222222222222';

    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES (?, 'MCC2026-0200', 'Bob', 'Brown', 'ACTIVE', ?, ?)`,
      [uuid, now, now]
    );

    const remoteRecords = [
      {
        id: uuid,
        school_id: 'MCC2026-0200',
        first_name: 'Bob',
        last_name: 'Brown',
        status: 'ACTIVE',
        updated_at: now,
      },
    ];

    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);
    expect(summary.unchanged).toBe(1);
    expect(operations[0].action).toBe('UNCHANGED');
  });

  it('Scenario 6: Unknown School ID classifies as INSERT', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const remoteId = '33333333-3333-4333-8333-333333333333';

    const remoteRecords = [
      {
        id: remoteId,
        school_id: 'MCC2026-0333',
        first_name: 'Charlie',
        last_name: 'Chaplin',
        status: 'ACTIVE',
        created_at: now,
        updated_at: now,
      },
    ];

    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);
    expect(summary.toInsert).toBe(1);
    expect(operations[0].action).toBe('INSERT');
  });

  it('Scenario 7: Multiple conflicting local matches classifies as CONFLICT requiring review', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Insert 2 local students that share or map to the same canonical School ID
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('dup_1', 'MCC2026-0777', 'Dave', 'Miller', 'ACTIVE', ?, ?)`,
      [now, now]
    );
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('dup_2', 'MCC-2026-0777', 'David', 'Miller', 'ACTIVE', ?, ?)`,
      [now, now]
    );

    const remoteRecords = [
      {
        id: '77777777-7777-4777-8777-777777777777',
        school_id: 'MCC2026-0777',
        first_name: 'Dave',
        last_name: 'Miller',
        status: 'ACTIVE',
      },
    ];

    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);
    expect(summary.conflicts).toBe(1);
    expect(operations[0].action).toBe('CONFLICT');
    expect(operations[0].isSafeToApply).toBe(false);
  });

  it('Scenario 8: Names match but School IDs differ: does not automatically merge', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('local_same_name', 'MCC2026-0111', 'SameName', 'Student', 'ACTIVE', ?, ?)`,
      [now, now]
    );

    // Remote student has same name but totally different School ID
    const remoteRecords = [
      {
        id: '88888888-8888-4888-8888-888888888888',
        school_id: 'MCC2026-0222',
        first_name: 'SameName',
        last_name: 'Student',
        status: 'ACTIVE',
      },
    ];

    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);
    // MUST NOT merge: must be classified as a clean INSERT for the new School ID!
    expect(summary.toInsert).toBe(1);
    expect(summary.identityMatches).toBe(0);
    expect(operations[0].action).toBe('INSERT');
  });

  it('Scenario 9: Different names with same School ID classifies as identity match review with visible differences', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('local_diff_name', 'MCC-2026-0444', 'OldFirstName', 'OldLastName', 'ACTIVE', ?, ?)`,
      [now, now]
    );

    const remoteRecords = [
      {
        id: '44444444-4444-4444-8444-444444444444',
        school_id: 'MCC2026-0444',
        first_name: 'NewFirstName',
        last_name: 'NewLastName',
        status: 'ACTIVE',
      },
    ];

    const { operations, summary } = await PullReconciliationService.analyzeStudentBatch(db, remoteRecords);
    expect(summary.identityMatches).toBe(1);
    expect(operations[0].fieldDifferences.some((d) => d.field === 'first_name')).toBe(true);
    expect(operations[0].fieldDifferences.some((d) => d.field === 'last_name')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Scenarios 10, 11, 12: Referential Integrity & Child Record Preservation
  // ---------------------------------------------------------------------------
  it('Scenarios 10, 11, 12: Pending outbox, enrollments, NFC cards, attendance and financial records are preserved upon reconciliation', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const localId = 'client_local_student_123';
    const remoteId = '12345678-1234-4234-8234-123456789012';

    // 1. Setup prerequisite academic year, semester, device, and local student
    await db.execute(
      `INSERT INTO academic_years (id, label, starts_on, ends_on, status)
       VALUES ('ay_2026', '2026-2027', '2026-06-01', '2027-03-31', 'ACTIVE')`
    );
    await db.execute(
      `INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status)
       VALUES ('sem_2026_1', 'ay_2026', 'FIRST', '2026-06-01', '2026-10-31', 'ACTIVE')`
    );
    await db.execute(
      `INSERT INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_test', 'Test Terminal', 'DEV-01', 'ACTIVE', ?)` ,
      [now]
    );
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('usr_admin', 'admin_test', 'ACTIVE', ?, ?)`,
      [now, now]
    );
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, photo_local_uri, status, created_at, updated_at)
       VALUES (?, 'MCC-2026-0123', 'Eve', 'Adams', 'file:///local/photo.jpg', 'ACTIVE', ?, ?)`,
      [localId, now, now]
    );

    // 2. Attach enrollment, NFC card, attendance, payment, and outbox operation
    await db.execute(
      `INSERT INTO student_enrollments (id, student_id, semester_id, year_level, section, first_name_snapshot, last_name_snapshot, updated_at)
       VALUES ('enr_123', ?, 'sem_2026_1', 2, '2A', 'Eve', 'Adams', ?)`,
      [localId, now]
    );
    await db.execute(
      `INSERT INTO nfc_cards (id, student_id, uid_normalized, status, assigned_at)
       VALUES ('crd_123', ?, '04:AA:BB:CC', 'ACTIVE', ?)`,
      [localId, now]
    );
    await db.execute(
      `INSERT INTO events (id, semester_id, title, status, created_by_user_id, created_at, updated_at)
       VALUES ('ev_1', 'sem_2026_1', 'CS Summit', 'ACTIVE', 'usr_admin', ?, ?)`,
      [now, now]
    );
    const laterToday = new Date(Date.now() + 3600000).toISOString();
    await db.execute(
      `INSERT INTO event_occurrences (id, event_id, title, occurs_on, starts_at, ends_at, status, updated_at)
       VALUES ('occ_1', 'ev_1', 'Morning Session', ?, ?, ?, 'OPEN', ?)`,
      [now.substring(0, 10), now, laterToday, now]
    );
    await db.execute(
      `INSERT INTO attendance_records (id, occurrence_id, student_id, status, method, client_scanned_at, updated_at)
       VALUES ('att_123', 'occ_1', ?, 'PRESENT', 'NFC', ?, ?)`,
      [localId, now, now]
    );
    await db.execute(
      `INSERT INTO payments (id, student_id, semester_id, reference_number, idempotency_key, amount_centavos, source, channel, status, processed_by_user_id, processed_at)
       VALUES ('pay_123', ?, 'sem_2026_1', 'REF-12345', 'IDEM-12345', 10000, 'CASH_RECORDED', 'MANUAL', 'POSTED', 'usr_admin', ?)`,
      [localId, now]
    );
    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES ('out_123', 'dev_test', 'STUDENT', ?, 'UPDATE', '{"test":true}', ?)`,
      [localId, now]
    );

    // 3. Perform reconciliation to remoteId
    await StudentsRepository.reconcileStudentId(localId, remoteId, 'MCC2026-0123', db);

    // Verify foreign key remapping across all child tables
    const enr = await db.queryOne<{ student_id: string }>('SELECT student_id FROM student_enrollments WHERE id = "enr_123"');
    expect(enr?.student_id).toBe(remoteId);

    const crd = await db.queryOne<{ student_id: string }>('SELECT student_id FROM nfc_cards WHERE id = "crd_123"');
    expect(crd?.student_id).toBe(remoteId);

    const att = await db.queryOne<{ student_id: string }>('SELECT student_id FROM attendance_records WHERE id = "att_123"');
    expect(att?.student_id).toBe(remoteId);

    const pay = await db.queryOne<{ student_id: string; amount_centavos: number }>('SELECT student_id, amount_centavos FROM payments WHERE id = "pay_123"');
    expect(pay?.student_id).toBe(remoteId);
    expect(pay?.amount_centavos).toBe(10000); // Financial value exactly preserved

    const out = await db.queryOne<{ entity_id: string }>('SELECT entity_id FROM sync_outbox WHERE id = "out_123"');
    expect(out?.entity_id).toBe(remoteId);

    // Verify photo_local_uri is preserved on new authoritative student record
    const stu = await db.queryOne<{ photo_local_uri: string; school_id: string }>('SELECT photo_local_uri, school_id FROM students WHERE id = ?', [remoteId]);
    expect(stu?.photo_local_uri).toBe('file:///local/photo.jpg');
    expect(stu?.school_id).toBe('MCC2026-0123');

    // Old student row is cleaned up without leaving orphaned records
    const oldStu = await db.queryOne('SELECT id FROM students WHERE id = ?', [localId]);
    expect(oldStu).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Scenarios 13, 14, 15, 16: Preview Plan Preflight Safety & Transaction Rollback
  // ---------------------------------------------------------------------------
  it('Scenario 13 & 14: Manual pull preview without approval makes NO changes to SQLite or checkpoints; Cancel Pull leaves state intact', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Checkpoint initially at 0
    await EntityCheckpointService.resetCheckpoint(db, 'students');

    const remoteRecords = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        school_id: 'MCC2026-0555',
        first_name: 'Unapplied',
        last_name: 'Student',
        status: 'ACTIVE',
      },
    ];

    // Generate preview plan (read-only)
    const plan = await PullReconciliationService.generatePreviewPlan(remoteRecords, {
      entity: 'students',
      nextSince: now,
    });
    expect(plan.operations.length).toBe(1);

    // Check SQLite: Record MUST NOT be in database
    const inDb = await db.queryOne('SELECT id FROM students WHERE id = "55555555-5555-4555-8555-555555555555"');
    expect(inDb).toBeNull();

    // Checkpoint MUST NOT have advanced
    const cp = await EntityCheckpointService.getCheckpoint(db, 'students');
    expect(cp.last_pulled_at.startsWith('1970-01-01')).toBe(true);
  });

  it('Scenario 15: Approved pull applies only validated operations and advances checkpoints durably', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const remoteRecords = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        school_id: 'MCC2026-0666',
        first_name: 'Approved',
        last_name: 'Student',
        status: 'ACTIVE',
      },
    ];

    const plan = await PullReconciliationService.generatePreviewPlan(remoteRecords, {
      entity: 'students',
      nextSince: now,
    });

    const res = await PullReconciliationService.applyApprovedPlan(plan, db);
    expect(res.success).toBe(true);
    expect(res.appliedCount).toBe(1);

    // Record is present
    const inDb = await db.queryOne<{ school_id: string }>('SELECT school_id FROM students WHERE id = "66666666-6666-4666-8666-666666666666"');
    expect(inDb?.school_id).toBe('MCC2026-0666');

    // Checkpoint has advanced
    const cp = await EntityCheckpointService.getCheckpoint(db, 'students');
    expect(cp.last_pulled_at).toBe(now);
  });

  it('Scenario 16: Failed ingestion rolls back transaction and preserves checkpoints', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const plan = await PullReconciliationService.generatePreviewPlan([], {
      entity: 'students',
      nextSince: now,
    });

    // Artificially inject an operation that violates a NOT NULL constraint to trigger failure
    plan.operations.push({
      id: 'bad_op',
      remoteId: 'invalid_id',
      schoolId: '',
      canonicalSchoolId: '',
      studentName: 'Fail',
      localState: 'Missing',
      remoteState: 'Corrupted',
      action: 'INSERT',
      reason: 'Constraint failure test',
      remoteRecord: { id: null }, // triggers error
      fieldDifferences: [],
      isSafeToApply: true,
      requiresReview: false,
      approved: true,
    });

    const res = await PullReconciliationService.applyApprovedPlan(plan, db);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();

    // Checkpoint MUST NOT have advanced
    const cp = await EntityCheckpointService.getCheckpoint(db, 'students');
    expect(cp.last_pulled_at.startsWith('1970-01-01')).toBe(true);
  });

  it('Scenario 17: Running pull twice is idempotent and does not duplicate rows', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const remoteRecords = [
      {
        id: '77777777-1111-4111-8111-777777777777',
        school_id: 'MCC2026-0771',
        first_name: 'Idempotent',
        last_name: 'Test',
        status: 'ACTIVE',
      },
    ];

    // First pull
    const plan1 = await PullReconciliationService.generatePreviewPlan(remoteRecords);
    await PullReconciliationService.applyApprovedPlan(plan1, db);

    const count1 = (await db.queryOne<{ count: number }>('SELECT count(*) as count FROM students WHERE school_id = "MCC2026-0771"'))?.count;
    expect(count1).toBe(1);

    // Second pull with same data
    const plan2 = await PullReconciliationService.generatePreviewPlan(remoteRecords);
    expect(plan2.summary.unchanged).toBe(1);
    await PullReconciliationService.applyApprovedPlan(plan2, db);

    const count2 = (await db.queryOne<{ count: number }>('SELECT count(*) as count FROM students WHERE school_id = "MCC2026-0771"'))?.count;
    expect(count2).toBe(1); // Still exactly 1!
  });

  it('Scenario 18: Pulling from a fresh empty device cleanly inserts all records', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const remoteRecords = [
      { id: 'fresh_1', school_id: 'MCC2026-0001', first_name: 'Fresh', last_name: 'One', status: 'ACTIVE' },
      { id: 'fresh_2', school_id: 'MCC2026-0002', first_name: 'Fresh', last_name: 'Two', status: 'ACTIVE' },
    ];

    const plan = await PullReconciliationService.generatePreviewPlan(remoteRecords);
    expect(plan.summary.toInsert).toBe(2);

    const res = await PullReconciliationService.applyApprovedPlan(plan, db);
    expect(res.success).toBe(true);
    expect(res.appliedCount).toBe(2);

    const count = (await db.queryOne<{ count: number }>('SELECT count(*) as count FROM students'))?.count;
    expect(count).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Scenario 20: Activation and Login for Both Accepted School ID Formats
  // ---------------------------------------------------------------------------
  it('Scenario 20: validateActivationCode matches both canonical and hyphenated School ID formats', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const studentId = 'act_student_uuid_001';
    const schoolId = 'MCC2026-0888';
    const rawCode = '23456789';
    const tokenHash = await AccountLinkingService.hashActivationCode(rawCode);

    // Seed student in SQLite
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES (?, ?, 'Activation', 'Candidate', 'ACTIVE', ?, ?)`,
      [studentId, schoolId, now, now]
    );

    // Seed user for foreign key constraint on activation_claims
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('usr_officer', 'officer_user', 'ACTIVE', ?, ?)`,
      [now, now]
    );

    // Seed activation claim
    await db.execute(
      `INSERT INTO activation_claims (id, student_id, token_hash, issued_by_user_id, expires_at, created_at, attempt_count, max_attempts)
       VALUES ('claim_001', ?, ?, 'usr_officer', ?, ?, 0, 5)`,
      [studentId, tokenHash, new Date(Date.now() + 86400000).toISOString(), now]
    );

    // Test with hyphenated format 'MCC-2026-0888'
    const hyphenatedRes = await AccountLinkingService.validateActivationCode('MCC-2026-0888', rawCode);
    expect(hyphenatedRes.valid).toBe(true);
    expect(hyphenatedRes.studentName).toContain('Activation Candidate');

    // Test with canonical format 'MCC2026-0888'
    const canonicalRes = await AccountLinkingService.validateActivationCode('MCC2026-0888', rawCode);
    expect(canonicalRes.valid).toBe(true);
    expect(canonicalRes.studentName).toContain('Activation Candidate');
  });

  // ---------------------------------------------------------------------------
  // Scenario 21: Push CREATE with existing canonical School ID
  // ---------------------------------------------------------------------------
  it('Scenario 21: Student lookup in SQLite by canonical or variant format finds the existing student', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    // Store student with hyphenated format
    await db.execute(
      `INSERT INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
       VALUES ('stu_variant_1', 'MCC-2026-0555', 'Variant', 'Student', 'ACTIVE', ?, ?)`,
      [now, now]
    );

    // Query with canonical format 'MCC2026-0555'
    const byCanonical = await StudentsRepository.getStudentBySchoolId('MCC2026-0555', db);
    expect(byCanonical).not.toBeNull();
    expect(byCanonical?.id).toBe('stu_variant_1');

    // Query with hyphenated format 'MCC-2026-0555'
    const byHyphen = await StudentsRepository.getStudentBySchoolId('MCC-2026-0555', db);
    expect(byHyphen).not.toBeNull();
    expect(byHyphen?.id).toBe('stu_variant_1');
  });
});
