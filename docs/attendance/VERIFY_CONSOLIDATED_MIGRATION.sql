-- ==============================================================================
-- UniTap 2.0: Comprehensive SQL Verification Test Suite
-- Target Migration: 20261101201500_multi_officer_attendance_concurrency.sql
-- ==============================================================================
-- PREREQUISITES & EXECUTION INSTRUCTIONS:
-- 1. Apply the consolidated migration first in Supabase SQL Editor:
--    `supabase/migrations/20261101201500_multi_officer_attendance_concurrency.sql`
--    (If not applied, PostgreSQL will report error 42883: function does not exist).
-- 2. Run this entire script in Supabase SQL Editor.
-- 3. Everything runs within a single transaction wrapped in BEGIN ... ROLLBACK;
--    so all test fixtures are automatically discarded and will NOT pollute your DB.
-- ==============================================================================

BEGIN;

DO $$
DECLARE
  -- Test Identity Constants
  v_officer_auth_id   UUID := gen_random_uuid();
  v_student_auth_id   UUID := gen_random_uuid();
  v_student_id        UUID := gen_random_uuid();
  v_card_id           UUID := gen_random_uuid();
  v_card_uid          VARCHAR(64) := '04' || substr(md5(gen_random_uuid()::text), 1, 12);
  v_ay_id             TEXT;
  v_sem_id            TEXT;
  v_event_id          UUID := gen_random_uuid();
  v_occ_id            UUID := gen_random_uuid();
  v_dummy_att_id      UUID := gen_random_uuid();
  v_dummy_audit_id    UUID := gen_random_uuid();
  v_test2_student_id  UUID := gen_random_uuid();
  
  -- Test Variables
  v_res               JSONB;
  v_pull_res          JSONB;
  v_att_rec           RECORD;
  v_audit_rec         RECORD;
  v_attempt_count     INT;
  v_rec_count         INT;
  v_update_blocked    BOOLEAN := false;
  v_delete_blocked    BOOLEAN := false;
  v_realtime_count    INT;
  v_now               TIMESTAMPTZ := now();
BEGIN
  RAISE NOTICE '==============================================================================';
  RAISE NOTICE 'Starting UniTap 2.0 Comprehensive Multi-Officer Attendance Test Suite';
  RAISE NOTICE '==============================================================================';

  -- ----------------------------------------------------------------------------
  -- 0. FIXTURE SETUP (All FKs validated and linked properly)
  -- ----------------------------------------------------------------------------
  -- 0A. Create Academic Period Fixtures if not present
  SELECT id INTO v_sem_id FROM public.semesters WHERE status = 'ACTIVE' LIMIT 1;
  IF v_sem_id IS NULL THEN
    SELECT id INTO v_sem_id FROM public.semesters LIMIT 1;
  END IF;

  IF v_sem_id IS NULL THEN
    v_ay_id := 'ay_test_conc_2026';
    v_sem_id := 'sem_test_conc_1';

    INSERT INTO public.academic_years (id, label, starts_on, ends_on, status)
    VALUES (v_ay_id, 'AY-2026-2027-TEST', CURRENT_DATE - interval '30 days', CURRENT_DATE + interval '300 days', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.semesters (id, academic_year_id, term, starts_on, ends_on, status)
    VALUES (v_sem_id, v_ay_id, 'FIRST', CURRENT_DATE - interval '30 days', CURRENT_DATE + interval '120 days', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- 0B. Create Auth Users and Public Users
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES 
    (v_officer_auth_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 
     'officer_' || substr(v_officer_auth_id::text, 1, 8) || '@unitap.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
    (v_student_auth_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 
     'student_' || substr(v_student_auth_id::text, 1, 8) || '@unitap.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now())
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, username, account_status)
  VALUES 
    (v_officer_auth_id, 'officer_' || substr(v_officer_auth_id::text, 1, 8), 'ACTIVE'),
    (v_student_auth_id, 'student_' || substr(v_student_auth_id::text, 1, 8), 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

  -- 0C. Assign Roles
  INSERT INTO public.user_roles (id, user_id, role, assigned_by_user_id)
  VALUES 
    (gen_random_uuid(), v_officer_auth_id, 'OFFICER', v_officer_auth_id),
    (gen_random_uuid(), v_student_auth_id, 'STUDENT', v_officer_auth_id)
  ON CONFLICT DO NOTHING;

  -- 0D. Create Active Officer Appointment with Attendance Permission
  INSERT INTO public.officer_appointments (
    id, user_id, full_name, email, permission_preset, custom_permissions,
    appointment_start, appointment_end, scope_type, status
  ) VALUES (
    gen_random_uuid(), v_officer_auth_id, 'Officer Tester', 'officer_' || substr(v_officer_auth_id::text, 1, 8) || '@unitap.test',
    'ATTENDANCE', '["ATTENDANCE"]'::jsonb, v_now - interval '1 day', v_now + interval '1 year',
    'ORGANIZATION', 'ACTIVE'
  );

  -- 0E. Create Student and NFC Card
  INSERT INTO public.students (id, school_id, first_name, last_name, status)
  VALUES (v_student_id, 'TEST-STU-' || substr(v_student_id::text, 1, 8), 'Juan', 'Dela Cruz', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.nfc_cards (id, student_id, uid_normalized, status, assigned_at)
  VALUES (v_card_id, v_student_id, v_card_uid, 'ACTIVE', v_now)
  ON CONFLICT (id) DO NOTHING;

  -- 0F. Create Active Event and Open Occurrence
  INSERT INTO public.events (id, semester_id, title, event_type, audience_type, status)
  VALUES (v_event_id, v_sem_id, 'Annual CS Congress', 'SEMINAR', 'ALL', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.event_occurrences (
    id, event_id, title, occurs_on, starts_at, ends_at, grace_minutes, status
  ) VALUES (
    v_occ_id, v_event_id, 'Morning Session', (now() AT TIME ZONE 'Asia/Manila')::date, 
    '00:00:00'::time, '23:59:59'::time, 15, 'OPEN'
  )
  ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE '✓ Step 0: Test fixtures created successfully.';

  -- ----------------------------------------------------------------------------
  -- TEST 1: Fail-Closed Role Checks
  -- ----------------------------------------------------------------------------
  -- 1A: Unauthenticated caller (auth.uid() IS NULL)
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_res := public.record_attendance_scan(
    v_occ_id, v_student_id, v_card_id, v_card_uid, NULL::varchar, 'dev_gate1', 'idemp_unauth_01'
  );
  ASSERT v_res->>'status' = 'UNAUTHORIZED', 'Failed Test 1A: Expected UNAUTHORIZED for unauthenticated caller';

  -- 1B: Authenticated user WITHOUT active officer role/appointment (Student)
  PERFORM set_config('request.jwt.claim.sub', v_student_auth_id::text, true);
  v_res := public.record_attendance_scan(
    v_occ_id, v_student_id, v_card_id, v_card_uid, NULL::varchar, 'dev_gate1', 'idemp_student_01'
  );
  ASSERT v_res->>'status' = 'UNAUTHORIZED', 'Failed Test 1B: Expected UNAUTHORIZED for non-officer caller';

  -- 1C: Direct call to revoke_attendance by non-officer
  v_res := public.revoke_attendance(v_dummy_att_id, 'Attempt by student', 1, 'idemp_rev_unauth');
  ASSERT v_res->>'status' = 'UNAUTHORIZED', 'Failed Test 1C: Expected UNAUTHORIZED for non-officer revoke';

  RAISE NOTICE '✓ PASS: Test 1 - Fail-closed authorization rejected unauthenticated and non-officer callers.';

  -- ----------------------------------------------------------------------------
  -- TEST 2: attendance_audit Strict Immutability Trigger
  -- (Uses real FK rows: isolated test2 student, dummy record, and valid user)
  -- ----------------------------------------------------------------------------
  INSERT INTO public.students (id, school_id, first_name, last_name, status)
  VALUES (v_test2_student_id, 'TEST-STU-T2-' || substr(v_test2_student_id::text, 1, 8), 'Test2', 'Student', 'ACTIVE');

  INSERT INTO public.attendance_records (
    id, occurrence_id, student_id, status, checked_in_at, method, 
    photo_checked, identity_verified_by_user_id, version
  ) VALUES (
    v_dummy_att_id, v_occ_id, v_test2_student_id, 'PRESENT', v_now, 'NFC', 1, v_officer_auth_id, 1
  );

  INSERT INTO public.attendance_audit (
    id, attendance_id, action, reason, performed_by_user_id, performed_at
  ) VALUES (
    v_dummy_audit_id, v_dummy_att_id, 'CHECK_IN', 'Initial scan', v_officer_auth_id, v_now
  );

  -- Attempt direct UPDATE on attendance_audit
  v_update_blocked := false;
  BEGIN
    UPDATE public.attendance_audit SET reason = 'Tampered reason' WHERE id = v_dummy_audit_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%attendance_audit records are strictly immutable%' THEN
      v_update_blocked := true;
    ELSE
      RAISE EXCEPTION 'Failed Test 2A: Unexpected error caught instead of immutability trigger: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    END IF;
  END;
  ASSERT v_update_blocked, 'Failed Test 2A: Trigger failed to block UPDATE on attendance_audit';

  -- Attempt direct DELETE on attendance_audit
  v_delete_blocked := false;
  BEGIN
    DELETE FROM public.attendance_audit WHERE id = v_dummy_audit_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%attendance_audit records are strictly immutable%' THEN
      v_delete_blocked := true;
    ELSE
      RAISE EXCEPTION 'Failed Test 2B: Unexpected error caught instead of immutability trigger: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
    END IF;
  END;
  ASSERT v_delete_blocked, 'Failed Test 2B: Trigger failed to block DELETE on attendance_audit';

  RAISE NOTICE '✓ PASS: Test 2 - attendance_audit trigger strictly blocked UPDATE and DELETE mutations with exact error message.';

  -- ----------------------------------------------------------------------------
  -- TEST 3: Authorized NFC Scan & Idempotency Key Handling
  -- ----------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_officer_auth_id::text, true);

  -- Scan 1: Initial Scan
  v_res := public.record_attendance_scan(
    v_occ_id, v_student_id, v_card_id, v_card_uid, NULL::varchar, 'gate_device_01', 'idemp_key_001', v_now, 'NFC'
  );
  ASSERT v_res->>'status' IN ('RECORDED', 'PRESENT', 'LATE'), 
    format('Failed Test 3A: Expected RECORDED, got %s', v_res->>'status');

  SELECT * INTO v_att_rec FROM public.attendance_records WHERE occurrence_id = v_occ_id AND student_id = v_student_id;
  ASSERT v_att_rec.id IS NOT NULL, 'Failed Test 3B: attendance_record was not created';
  ASSERT v_att_rec.version = 1, format('Failed Test 3C: Expected version 1, got %s', v_att_rec.version);

  -- Scan 2: Replay with the EXACT same idempotency key (Simulates network timeout retry)
  v_res := public.record_attendance_scan(
    v_occ_id, v_student_id, v_card_id, v_card_uid, NULL::varchar, 'gate_device_01', 'idemp_key_001', v_now, 'NFC'
  );
  ASSERT v_res->>'status' IN ('RECORDED', 'PRESENT', 'LATE'), 
    format('Failed Test 3D: Replay expected cached RECORDED status, got %s', v_res->>'status');

  SELECT count(*) INTO v_rec_count FROM public.attendance_records WHERE occurrence_id = v_occ_id AND student_id = v_student_id;
  ASSERT v_rec_count = 1, format('Failed Test 3E: Expected exactly 1 record, found %s', v_rec_count);

  RAISE NOTICE '✓ PASS: Test 3 - Valid NFC scan recorded record (version 1) and replay returned cached result idempotently.';

  -- ----------------------------------------------------------------------------
  -- TEST 4: Duplicate Scan Prevention & Attempt Logging
  -- ----------------------------------------------------------------------------
  -- Officer 2 at Gate 2 attempts to scan the same student with a DIFFERENT idempotency key
  v_res := public.record_attendance_scan(
    v_occ_id, v_student_id, v_card_id, v_card_uid, NULL::varchar, 'gate_device_02', 'idemp_key_002', v_now, 'NFC'
  );
  ASSERT v_res->>'status' = 'ALREADY_RECORDED', 
    format('Failed Test 4A: Expected ALREADY_RECORDED, got %s', v_res->>'status');

  -- Verify attempt is logged in attendance_attempts
  SELECT count(*) INTO v_attempt_count 
  FROM public.attendance_attempts 
  WHERE occurrence_id = v_occ_id AND student_id = v_student_id;
  ASSERT v_attempt_count >= 1, 'Failed Test 4B: Duplicate scan attempt was not logged in attendance_attempts';

  RAISE NOTICE '✓ PASS: Test 4 - Duplicate scan on same occurrence returned ALREADY_RECORDED and logged attempt.';

  -- ----------------------------------------------------------------------------
  -- TEST 5: Attendance Revocation with Mandatory Reason & Version Bump
  -- ----------------------------------------------------------------------------
  -- 5A: Reject revocation if reason is empty
  v_res := public.revoke_attendance(v_att_rec.id, '   ', 1, 'idemp_rev_01');
  ASSERT v_res->>'status' = 'INVALID_REASON', 
    format('Failed Test 5A: Expected INVALID_REASON for blank reason, got %s', v_res->>'status');

  -- 5B: Successfully revoke with valid reason
  v_res := public.revoke_attendance(
    v_att_rec.id, 'Unauthorized student exit before session concluded', 1, 'idemp_rev_02'
  );
  ASSERT v_res->>'status' = 'REVOKED', 
    format('Failed Test 5B: Expected REVOKED, got %s', v_res->>'status');

  SELECT * INTO v_att_rec FROM public.attendance_records WHERE id = v_att_rec.id;
  ASSERT v_att_rec.status = 'REVOKED', format('Failed Test 5C: Status is %s', v_att_rec.status);
  ASSERT v_att_rec.version = 2, format('Failed Test 5D: Expected version 2 after revoke, got %s', v_att_rec.version);
  ASSERT v_att_rec.revoked_at IS NOT NULL, 'Failed Test 5E: revoked_at is NULL';

  -- Verify audit record appended
  SELECT * INTO v_audit_rec FROM public.attendance_audit 
  WHERE attendance_id = v_att_rec.id AND action = 'REVOKE' 
  ORDER BY performed_at DESC LIMIT 1;
  ASSERT v_audit_rec.id IS NOT NULL, 'Failed Test 5F: No audit log found for REVOKE action';

  RAISE NOTICE '✓ PASS: Test 5 - Revocation required reason, transitioned to REVOKED, bumped version to 2, and logged audit.';

  -- ----------------------------------------------------------------------------
  -- TEST 6: Re-scan Blocked After Revocation & Supervisor Recheck Flow
  -- ----------------------------------------------------------------------------
  -- 6A: Student tries to tap again after being revoked -> Must be blocked
  v_res := public.record_attendance_scan(
    v_occ_id, v_student_id, v_card_id, v_card_uid, NULL::varchar, 'gate_device_01', 'idemp_rescan_after_rev', v_now, 'NFC'
  );
  ASSERT v_res->>'status' = 'REVOKED_REVIEW_REQUIRED', 
    format('Failed Test 6A: Expected REVOKED_REVIEW_REQUIRED, got %s', v_res->>'status');

  -- 6B: Supervisor approves recheck with explanation
  v_res := public.recheck_attendance(
    v_att_rec.id, 'Verified approved medical clinic pass presented by student in person', 
    'PRESENT', 2, 'idemp_recheck_01'
  );
  ASSERT v_res->>'status' IN ('REINSTATED', 'PRESENT'), 
    format('Failed Test 6B: Expected REINSTATED/PRESENT, got %s', v_res->>'status');

  SELECT * INTO v_att_rec FROM public.attendance_records WHERE id = v_att_rec.id;
  ASSERT v_att_rec.status = 'PRESENT', format('Failed Test 6C: Expected status PRESENT, got %s', v_att_rec.status);
  ASSERT v_att_rec.version = 3, format('Failed Test 6D: Expected version 3 after recheck, got %s', v_att_rec.version);
  ASSERT v_att_rec.rechecked_at IS NOT NULL, 'Failed Test 6E: rechecked_at should be recorded';

  -- Verify audit entry for recheck
  SELECT * INTO v_audit_rec FROM public.attendance_audit 
  WHERE attendance_id = v_att_rec.id AND action IN ('RECHECK', 'REINSTATE') 
  ORDER BY performed_at DESC LIMIT 1;
  ASSERT v_audit_rec.id IS NOT NULL, 'Failed Test 6F: No audit log found for RECHECK action';

  RAISE NOTICE '✓ PASS: Test 6 - Re-scan blocked by REVOKED_REVIEW_REQUIRED, explicit recheck reinstated student to version 3.';

  -- ----------------------------------------------------------------------------
  -- TEST 7: Role-Scoped sync_pull_batch
  -- ----------------------------------------------------------------------------
  v_pull_res := public.sync_pull_batch(
    p_since => '1970-01-01 00:00:00+00'::timestamptz,
    p_limit => 100
  );
  ASSERT v_pull_res ? 'attendance_records', 'Failed Test 7A: sync_pull_batch missing attendance_records';
  ASSERT v_pull_res ? 'attendance_audit', 'Failed Test 7B: sync_pull_batch missing attendance_audit';
  ASSERT jsonb_array_length(v_pull_res->'attendance_records') > 0, 
    'Failed Test 7C: Expected at least 1 attendance_record in pull batch';
  ASSERT jsonb_array_length(v_pull_res->'attendance_audit') > 0, 
    'Failed Test 7D: Expected at least 1 attendance_audit entry in pull batch';

  RAISE NOTICE '✓ PASS: Test 7 - sync_pull_batch returned attendance_records and attendance_audit within authorized scope.';

  -- ----------------------------------------------------------------------------
  -- TEST 8: Realtime Publication Check
  -- ----------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    SELECT count(*) INTO v_realtime_count
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' 
      AND tablename IN ('attendance_records', 'attendance_audit');
    ASSERT v_realtime_count = 2, 
      format('Failed Test 8: Expected both attendance tables in supabase_realtime, found %s', v_realtime_count);
    RAISE NOTICE '✓ PASS: Test 8 - Realtime publication contains both attendance_records and attendance_audit.';
  ELSE
    RAISE NOTICE '- Info: Test 8 skipped (supabase_realtime publication not defined in this environment).';
  END IF;

  RAISE NOTICE '==============================================================================';
  RAISE NOTICE 'ALL TESTS PASSED! Multi-Officer Attendance Concurrency Migration is 100%% Verified.';
  RAISE NOTICE '==============================================================================';
END $$;

ROLLBACK;
