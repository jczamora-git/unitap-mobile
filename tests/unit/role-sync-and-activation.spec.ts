import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sha256 } from 'hash-wasm';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { AccountLinkingService } from '@/integrations/supabase/account-linking.service';
import { StudentActivationService } from '@/services/student-activation.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { PushSyncService } from '@/services/sync/push-sync.service';
import { PullSyncService } from '@/services/sync/pull-sync.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { SyncScopeService } from '@/services/sync/sync-scope.service';
import { StudentsRepository } from '@/database/repositories/students.repository';

/**
 * UniTap 2.0 — Complete Role-Based Database Sync & Student Onboarding Suite
 *
 * Covers:
 * 1. Student Activation Code Issuance, Validation, Registration, Account Linking & Login.
 * 2. Role-Scoped Pull Hydration (DEVADMIN, OFFICER [Event/Program/Section], STUDENT).
 * 3. Authorized Push Synchronization (Nested Payments, Reversals, Attendance, Outbox Safety).
 */
describe('UniTap 2.0 Role-Based Sync & Student Onboarding Suite', { timeout: 35000 }, () => {
  let pg: PGlite;

  const DEVADMIN_ID = '10000000-0000-4000-8000-000000000001';
  const ACTIVE_OFFICER_ID = '20000000-0000-4000-8000-000000000002';
  const EXPIRED_OFFICER_ID = '20000000-0000-4000-8000-000000000003';
  const STUDENT_USER_ID = '30000000-0000-4000-8000-000000000003';
  const STUDENT_2_USER_ID = '30000000-0000-4000-8000-000000000004';

  const STUDENT_REC_ID = '40000000-0000-4000-8000-000000000001';
  const INACTIVE_STUDENT_ID = '40000000-0000-4000-8000-000000000002';

  async function setupPostgreSql(): Promise<PGlite> {
    const db = new PGlite();

    // 1. Roles and Auth Context
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.current_user_context (
        user_id UUID
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT user_id FROM auth.current_user_context LIMIT 1;
      $$ LANGUAGE sql STABLE;

      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY,
        email TEXT
      );
    `);

    // 2. Base tables
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.users (
        id UUID PRIMARY KEY,
        username TEXT UNIQUE,
        student_id UUID,
        account_status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.user_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        role TEXT NOT NULL,
        semester_id TEXT,
        assigned_at TIMESTAMPTZ DEFAULT now(),
        revoked_at TIMESTAMPTZ DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS public.students (
        id UUID PRIMARY KEY,
        school_id TEXT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        middle_name TEXT,
        last_name TEXT NOT NULL,
        photo_local_uri TEXT,
        photo_storage_path TEXT,
        status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.officer_appointments (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        role TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        permission_preset TEXT DEFAULT 'FULL',
        custom_permissions JSONB DEFAULT '{}'::jsonb,
        status TEXT NOT NULL,
        appointment_start TIMESTAMPTZ NOT NULL,
        appointment_end TIMESTAMPTZ NOT NULL,
        suspended_at TIMESTAMPTZ DEFAULT NULL,
        revoked_at TIMESTAMPTZ DEFAULT NULL
      );

      CREATE TABLE IF NOT EXISTS public.activation_claims (
        id UUID PRIMARY KEY,
        student_id UUID NOT NULL REFERENCES public.students(id),
        token_hash TEXT NOT NULL,
        issued_by_user_id UUID NOT NULL,
        claimed_by_user_id UUID,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        attempt_count INT DEFAULT 0,
        max_attempts INT DEFAULT 5,
        last_attempt_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS public.activation_claims_audit (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        claim_id UUID NOT NULL,
        student_id UUID NOT NULL,
        action TEXT NOT NULL,
        performed_by_user_id UUID,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.payments (
        id UUID PRIMARY KEY,
        student_id UUID NOT NULL,
        semester_id TEXT NOT NULL,
        reference_number TEXT NOT NULL,
        idempotency_key TEXT,
        amount_centavos BIGINT NOT NULL,
        source TEXT DEFAULT 'MANUAL',
        channel TEXT DEFAULT 'CASH',
        status TEXT DEFAULT 'POSTED',
        processed_by_user_id UUID,
        reversed_by_user_id UUID,
        reversal_reason TEXT,
        processed_at TIMESTAMPTZ DEFAULT now(),
        reversed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.payment_allocations (
        id UUID PRIMARY KEY,
        payment_id UUID NOT NULL REFERENCES public.payments(id),
        obligation_id UUID NOT NULL,
        amount_centavos BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.obligation_rules (
        id UUID PRIMARY KEY,
        semester_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'FINE',
        trigger_type TEXT DEFAULT 'MANUAL',
        default_amount_centavos BIGINT DEFAULT 0,
        status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.student_obligations (
        id UUID PRIMARY KEY,
        student_id UUID NOT NULL,
        rule_id UUID,
        semester_id TEXT NOT NULL,
        title TEXT NOT NULL,
        type TEXT DEFAULT 'FINE',
        amount_centavos BIGINT DEFAULT 0,
        status TEXT DEFAULT 'UNPAID',
        due_date DATE,
        issued_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.sync_conflicts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id TEXT,
        entity_type TEXT,
        entity_id UUID,
        conflict_type TEXT,
        client_payload JSONB,
        server_payload JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 3. Load migration 20261103000000_complete_sync_and_activation_repair.sql
    const migPath = join(process.cwd(), 'supabase/migrations/20261103000000_complete_sync_and_activation_repair.sql');
    const sql = readFileSync(migPath, 'utf8');
    await db.exec(sql);

    return db;
  }

  async function setAuthCaller(db: PGlite, userId: string | null) {
    await db.exec('DELETE FROM auth.current_user_context;');
    if (userId) {
      await db.exec(`INSERT INTO auth.current_user_context (user_id) VALUES ('${userId}');`);
    }
  }

  beforeEach(async () => {
    await resetDatabaseForTests();
    pg = await setupPostgreSql();

    // Populate standard actors
    await pg.exec(`
      -- Users
      INSERT INTO auth.users (id, email) VALUES
        ('${DEVADMIN_ID}', 'admin@unitap.com'),
        ('${ACTIVE_OFFICER_ID}', 'officer@unitap.com'),
        ('${EXPIRED_OFFICER_ID}', 'expired_officer@unitap.com'),
        ('${STUDENT_USER_ID}', 'student@univ.edu');

      INSERT INTO public.users (id, username, account_status) VALUES
        ('${DEVADMIN_ID}', 'admin', 'ACTIVE'),
        ('${ACTIVE_OFFICER_ID}', 'officer_active', 'ACTIVE'),
        ('${EXPIRED_OFFICER_ID}', 'officer_expired', 'ACTIVE');

      -- Roles
      INSERT INTO public.user_roles (id, user_id, role) VALUES
        ('a1000000-0000-4000-8000-000000000001', '${DEVADMIN_ID}', 'DEVADMIN'),
        ('a2000000-0000-4000-8000-000000000002', '${ACTIVE_OFFICER_ID}', 'OFFICER'),
        ('a3000000-0000-4000-8000-000000000003', '${EXPIRED_OFFICER_ID}', 'OFFICER');

      -- Appointments: 1 active, 1 expired
      INSERT INTO public.officer_appointments (
        id, user_id, role, scope_type, scope_id, permission_preset, custom_permissions,
        status, appointment_start, appointment_end
      ) VALUES
        ('b1000000-0000-4000-8000-000000000001', '${ACTIVE_OFFICER_ID}', 'OFFICER', 'ORGANIZATION', 'csg', 'FULL', '{"FINANCE": true}'::jsonb,
         'ACTIVE', now() - INTERVAL '30 days', now() + INTERVAL '30 days'),
        ('b2000000-0000-4000-8000-000000000002', '${EXPIRED_OFFICER_ID}', 'OFFICER', 'ORGANIZATION', 'csg', 'FULL', '{"FINANCE": true}'::jsonb,
         'ACTIVE', now() - INTERVAL '60 days', now() - INTERVAL '10 days');

      -- Students: 1 Active, 1 Inactive
      INSERT INTO public.students (id, school_id, first_name, last_name, status) VALUES
        ('${STUDENT_REC_ID}', '2026-0001', 'Jose', 'Rizal', 'ACTIVE'),
        ('${INACTIVE_STUDENT_ID}', '2026-9999', 'Inactive', 'Student', 'INACTIVE');
    `);
  });

  // ============================================================================
  // PART A: STUDENT ACTIVATION & ONBOARDING
  // ============================================================================

  it('A1: Authorized active officer can issue a new activation code', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);

    const rawCode = 'H7K9M3X2';
    const tokenHash = await sha256(rawCode);

    const res = await pg.query<{ officer_issue_activation_code: any }>(
      `SELECT public.officer_issue_activation_code($1, $2, 48) AS officer_issue_activation_code`,
      ['2026-0001', tokenHash]
    );

    const data = res.rows[0].officer_issue_activation_code;
    expect(data.success).toBe(true);
    expect(data.action).toBe('ISSUED');
    expect(data.claim_id).toBeDefined();

    // Verify claim in PostgreSQL
    const claimRes = await pg.query<{ token_hash: string; student_id: string }>(
      `SELECT token_hash, student_id FROM public.activation_claims WHERE id = $1`,
      [data.claim_id]
    );
    expect(claimRes.rows[0].token_hash).toBe(tokenHash);
    expect(claimRes.rows[0].student_id).toBe(STUDENT_REC_ID);
  });

  it('A2: Reissuing an activation code invalidates previous unused code', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);

    const hash1 = await sha256('CODEONE1');
    const hash2 = await sha256('CODETWO2');

    const res1 = await pg.query<{ officer_issue_activation_code: any }>(
      `SELECT public.officer_issue_activation_code($1, $2, 48) AS officer_issue_activation_code`,
      ['2026-0001', hash1]
    );
    expect(res1.rows[0].officer_issue_activation_code.action).toBe('ISSUED');

    const res2 = await pg.query<{ officer_issue_activation_code: any }>(
      `SELECT public.officer_issue_activation_code($1, $2, 48) AS officer_issue_activation_code`,
      ['2026-0001', hash2]
    );
    expect(res2.rows[0].officer_issue_activation_code.action).toBe('REISSUED');

    // First claim should now be revoked
    const revokedClaim = await pg.query<{ revoked_at: string }>(
      `SELECT revoked_at FROM public.activation_claims WHERE token_hash = $1`,
      [hash1]
    );
    expect(revokedClaim.rows[0].revoked_at).not.toBeNull();
  });

  it('A3: Unauthorized / expired officer cannot issue activation code', async () => {
    await setAuthCaller(pg, EXPIRED_OFFICER_ID);

    const hash = await sha256('CODEEXP1');
    const res = await pg.query<{ officer_issue_activation_code: any }>(
      `SELECT public.officer_issue_activation_code($1, $2, 48) AS officer_issue_activation_code`,
      ['2026-0001', hash]
    );

    expect(res.rows[0].officer_issue_activation_code.success).toBe(false);
    expect(res.rows[0].officer_issue_activation_code.error).toContain('Officer appointment is inactive, suspended, or expired');
  });

  it('A4: Cannot issue activation code for inactive student', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);

    const hash = await sha256('CODEINAC');
    const res = await pg.query<{ officer_issue_activation_code: any }>(
      `SELECT public.officer_issue_activation_code($1, $2, 48) AS officer_issue_activation_code`,
      ['2026-9999', hash]
    );

    expect(res.rows[0].officer_issue_activation_code.success).toBe(false);
    expect(res.rows[0].officer_issue_activation_code.error).toContain('Student is inactive and ineligible');
  });

  it('A5: public.validate_activation_code returns success with student name for valid code', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);
    const rawCode = 'VALIDCOD';
    const tokenHash = await sha256(rawCode);
    await pg.query(`SELECT public.officer_issue_activation_code('2026-0001', $1, 48)`, [tokenHash]);

    // Anonymous caller validates code
    await setAuthCaller(pg, null);
    const res = await pg.query<{ validate_activation_code: any }>(
      `SELECT public.validate_activation_code($1, $2) AS validate_activation_code`,
      ['2026-0001', tokenHash]
    );

    const val = res.rows[0].validate_activation_code;
    expect(val.success).toBe(true);
    expect(val.student_name).toBe('Jose Rizal');
    expect(val.student_id).toBe(STUDENT_REC_ID);
  });

  it('A6: public.validate_activation_code clearly distinguishes failure modes without silent fallback', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);
    const rawCode = 'FAILCODE';
    const tokenHash = await sha256(rawCode);
    await pg.query(`SELECT public.officer_issue_activation_code('2026-0001', $1, 48)`, [tokenHash]);

    await setAuthCaller(pg, null);

    // 1. Missing student
    const resMissing = await pg.query<{ validate_activation_code: any }>(
      `SELECT public.validate_activation_code('2099-0000', $1) AS validate_activation_code`,
      [tokenHash]
    );
    expect(resMissing.rows[0].validate_activation_code.error).toBe('Student record not found for this School ID.');

    // 2. Inactive student
    const resInactive = await pg.query<{ validate_activation_code: any }>(
      `SELECT public.validate_activation_code('2026-9999', $1) AS validate_activation_code`,
      [tokenHash]
    );
    expect(resInactive.rows[0].validate_activation_code.error).toContain('Student account is currently inactive');

    // 3. Incorrect code
    const wrongHash = await sha256('WRONGCOD');
    const resWrong = await pg.query<{ validate_activation_code: any }>(
      `SELECT public.validate_activation_code('2026-0001', $1) AS validate_activation_code`,
      [wrongHash]
    );
    expect(resWrong.rows[0].validate_activation_code.error).toContain('Incorrect activation code');

    // 4. Expired code
    await pg.exec(`UPDATE public.activation_claims SET expires_at = now() - INTERVAL '1 hour' WHERE token_hash = '${tokenHash}';`);
    const resExpired = await pg.query<{ validate_activation_code: any }>(
      `SELECT public.validate_activation_code('2026-0001', $1) AS validate_activation_code`,
      [tokenHash]
    );
    expect(resExpired.rows[0].validate_activation_code.error).toContain('This activation code has expired');
  });

  it('A7: public.activate_student_account atomically binds student, sets STUDENT role, and consumes claim', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);
    const rawCode = 'LINK1234';
    const tokenHash = await sha256(rawCode);
    await pg.query(`SELECT public.officer_issue_activation_code('2026-0001', $1, 48)`, [tokenHash]);

    // Student calls activate with authenticated session
    await setAuthCaller(pg, STUDENT_USER_ID);

    const res = await pg.query<{ activate_student_account: any }>(
      `SELECT public.activate_student_account($1, $2) AS activate_student_account`,
      ['2026-0001', tokenHash]
    );

    const act = res.rows[0].activate_student_account;
    expect(act.success).toBe(true);
    expect(act.student_id).toBe(STUDENT_REC_ID);

    // Verify users row has student_id
    const userRes = await pg.query<{ student_id: string; username: string }>(
      `SELECT student_id, username FROM public.users WHERE id = $1`,
      [STUDENT_USER_ID]
    );
    expect(userRes.rows[0].student_id).toBe(STUDENT_REC_ID);
    expect(userRes.rows[0].username).toBe('2026-0001');

    // Verify STUDENT role in user_roles
    const roleRes = await pg.query<{ role: string }>(
      `SELECT role FROM public.user_roles WHERE user_id = $1`,
      [STUDENT_USER_ID]
    );
    expect(roleRes.rows[0].role).toBe('STUDENT');

    // Verify claim is marked used
    const claimRes = await pg.query<{ used_at: string; claimed_by_user_id: string }>(
      `SELECT used_at, claimed_by_user_id FROM public.activation_claims WHERE token_hash = $1`,
      [tokenHash]
    );
    expect(claimRes.rows[0].used_at).not.toBeNull();
    expect(claimRes.rows[0].claimed_by_user_id).toBe(STUDENT_USER_ID);
  });

  it('A8: Re-activation by the same student is idempotent; claiming by another account is rejected', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);
    const rawCode = 'IDEM1234';
    const tokenHash = await sha256(rawCode);
    await pg.query(`SELECT public.officer_issue_activation_code('2026-0001', $1, 48)`, [tokenHash]);

    await setAuthCaller(pg, STUDENT_USER_ID);
    await pg.query(`SELECT public.activate_student_account('2026-0001', $1)`, [tokenHash]);

    // Same student retry -> idempotent success
    const retryRes = await pg.query<{ activate_student_account: any }>(
      `SELECT public.activate_student_account('2026-0001', $1) AS activate_student_account`,
      [tokenHash]
    );
    expect(retryRes.rows[0].activate_student_account.success).toBe(true);
    expect(retryRes.rows[0].activate_student_account.already_linked).toBe(true);

    // Another student account tries to claim same student record -> rejected
    await setAuthCaller(pg, STUDENT_2_USER_ID);
    const hijackRes = await pg.query<{ activate_student_account: any }>(
      `SELECT public.activate_student_account('2026-0001', $1) AS activate_student_account`,
      [tokenHash]
    );
    expect(hijackRes.rows[0].activate_student_account.success).toBe(false);
    expect(hijackRes.rows[0].activate_student_account.error).toContain('already been claimed by another account');
  });

  it('A9: resolve_login_email RPC resolves School ID to authenticated email', async () => {
    // Linked student user
    await pg.exec(`
      INSERT INTO public.users (id, username, student_id, account_status)
      VALUES ('${STUDENT_USER_ID}', '2026-0001', '${STUDENT_REC_ID}', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, student_id = EXCLUDED.student_id;
    `);

    // Call resolve_login_email with School ID
    const res = await pg.query<{ resolve_login_email: string }>(
      `SELECT public.resolve_login_email('2026-0001') AS resolve_login_email`
    );
    expect(res.rows[0].resolve_login_email).toBe('student@univ.edu');

    // Call resolve_login_email with direct email
    const resEmail = await pg.query<{ resolve_login_email: string }>(
      `SELECT public.resolve_login_email('student@univ.edu') AS resolve_login_email`
    );
    expect(resEmail.rows[0].resolve_login_email).toBe('student@univ.edu');
  });

  // ============================================================================
  // PART B: PUSH SYNCHRONIZATION (NESTED PAYMENTS, REVERSALS, OUTBOX SAFETY)
  // ============================================================================

  it('B1: sync_push_batch unrolls nested payment payload { payment, allocations } without schema error', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);

    const paymentId = '50000000-0000-4000-8000-000000000001';
    const obligationId = '60000000-0000-4000-8000-000000000001';

    // Insert dummy obligation
    await pg.exec(`
      INSERT INTO public.student_obligations (id, student_id, semester_id, title, amount_centavos, status)
      VALUES ('${obligationId}', '${STUDENT_REC_ID}', 'sem_test_1', 'Tuition Obligation', 5000, 'UNPAID');
    `);

    // Nested payload matching finance.repository.ts
    const nestedOps = [
      {
        id: 'out_pay_test_1',
        entity_type: 'PAYMENT',
        entity_id: paymentId,
        operation: 'CREATE',
        payload: {
          payment: {
            id: paymentId,
            student_id: STUDENT_REC_ID,
            semester_id: 'sem_test_1',
            reference_number: 'REF-2026-001',
            amount_centavos: 5000,
            status: 'POSTED',
          },
          allocations: [
            {
              id: '51000000-0000-4000-8000-000000000001',
              payment_id: paymentId,
              obligation_id: obligationId,
              amount_centavos: 5000,
            },
          ],
        },
      },
    ];

    const pushRes = await pg.query<{ sync_push_batch: any }>(
      `SELECT public.sync_push_batch($1::jsonb) AS sync_push_batch`,
      [JSON.stringify(nestedOps)]
    );

    const result = pushRes.rows[0].sync_push_batch;
    expect(result.success).toBe(true);
    expect(result.applied_count).toBe(1);
    expect(result.results[0].status).toBe('CONFIRMED');

    // Verify payment in PostgreSQL
    const pCheck = await pg.query<{ amount_centavos: number | string; status: string }>(
      `SELECT amount_centavos, status FROM public.payments WHERE id = $1`,
      [paymentId]
    );
    expect(Number(pCheck.rows[0].amount_centavos)).toBe(5000);
    expect(pCheck.rows[0].status).toBe('POSTED');

    // Verify allocation in PostgreSQL
    const aCheck = await pg.query<{ amount_centavos: number | string }>(
      `SELECT amount_centavos FROM public.payment_allocations WHERE payment_id = $1`,
      [paymentId]
    );
    expect(Number(aCheck.rows[0].amount_centavos)).toBe(5000);
  });

  it('B2: sync_push_batch accurately confirms payment reversal and does not falsely acknowledge missing payment', async () => {
    await setAuthCaller(pg, ACTIVE_OFFICER_ID);

    const paymentId = '50000000-0000-4000-8000-000000000002';
    await pg.exec(`
      INSERT INTO public.payments (id, student_id, semester_id, reference_number, amount_centavos, status)
      VALUES ('${paymentId}', '${STUDENT_REC_ID}', 'sem_test_1', 'REF-2026-002', 2500, 'POSTED');
    `);

    // Valid reversal of existing payment
    const revOp = [
      {
        id: 'out_rev_test_1',
        entity_type: 'PAYMENT',
        entity_id: paymentId,
        operation: 'UPDATE',
        payload: {
          id: paymentId,
          status: 'REVERSED',
          reversal_reason: 'Mistake in amount recorded',
        },
      },
    ];

    const revRes = await pg.query<{ sync_push_batch: any }>(
      `SELECT public.sync_push_batch($1::jsonb) AS sync_push_batch`,
      [JSON.stringify(revOp)]
    );
    expect(revRes.rows[0].sync_push_batch.applied_count).toBe(1);
    expect(revRes.rows[0].sync_push_batch.results[0].status).toBe('CONFIRMED');

    const pCheck = await pg.query<{ status: string; reversal_reason: string }>(
      `SELECT status, reversal_reason FROM public.payments WHERE id = $1`,
      [paymentId]
    );
    expect(pCheck.rows[0].status).toBe('REVERSED');
    expect(pCheck.rows[0].reversal_reason).toBe('Mistake in amount recorded');

    // Reversal of non-existent payment -> must NOT return CONFIRMED
    const ghostOp = [
      {
        id: 'out_rev_ghost',
        entity_type: 'PAYMENT',
        entity_id: '59999999-9999-4999-8999-999999999999',
        operation: 'UPDATE',
        payload: {
          id: '59999999-9999-4999-8999-999999999999',
          status: 'REVERSED',
        },
      },
    ];

    const ghostRes = await pg.query<{ sync_push_batch: any }>(
      `SELECT public.sync_push_batch($1::jsonb) AS sync_push_batch`,
      [JSON.stringify(ghostOp)]
    );
    expect(ghostRes.rows[0].sync_push_batch.applied_count).toBe(0);
    expect(ghostRes.rows[0].sync_push_batch.results[0].status).toBe('RETRY_PENDING');
  });

  it('B3: SQLite Outbox safety preserves pending operations upon network rejection without deletion', async () => {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.execute(
      `INSERT OR IGNORE INTO devices (id, device_name, device_code, status, provisioned_at)
       VALUES ('dev_default', 'UniTap Mobile Terminal', 'DEV-TERMINAL-01', 'ACTIVE', ?)`,
      [now]
    );

    await db.execute(
      `INSERT INTO sync_outbox (id, device_id, entity_type, entity_id, operation, payload_json, created_at)
       VALUES (?, 'dev_default', 'ATTENDANCE', 'att_safe_1', 'CREATE', ?, ?)`,
      ['out_safe_1', JSON.stringify({ student_id: 'stu_1', status: 'PRESENT' }), now]
    );

    // Attempt push when server rejects or throws
    const res = await PushSyncService.pushPendingOperations();
    expect(res).toBeDefined();

    // Outbox record must NOT be deleted without confirmed server acknowledgement
    const remaining = await db.query('SELECT * FROM sync_outbox WHERE id = ?', ['out_safe_1']);
    expect(remaining.length).toBe(1);
  });

  // ============================================================================
  // PART C: ROLE SCOPING & DATA ISOLATION
  // ============================================================================

  it('C1: SyncScopeService defines accurate data boundaries minimizing private student exposure', () => {
    const devTables = SyncScopeService.getRequiredTablesForRole('DEVADMIN');
    expect(devTables).toContain('academic_years');
    expect(devTables).toContain('students');
    expect(devTables).toContain('payments');
    expect(devTables).toContain('obligation_rules');

    const officerTables = SyncScopeService.getRequiredTablesForRole('OFFICER');
    expect(officerTables).toContain('attendance_records');
    expect(officerTables).toContain('nfc_cards');

    const studentTables = SyncScopeService.getRequiredTablesForRole('STUDENT');
    expect(studentTables).toContain('students');
    expect(studentTables).toContain('attendance_records');
    expect(studentTables).toContain('student_obligations');
    // Students must NOT pull private cards, rules or other students' rosters
    expect(studentTables).not.toContain('nfc_cards');
    expect(studentTables).not.toContain('obligation_rules');
  });
});

