-- ==============================================================================
-- UniTap 2.0 — COMPLETE ROLE-BASED DATABASE SYNCHRONIZATION & STUDENT ONBOARDING
-- Migration: 20261103000000_complete_sync_and_activation_repair.sql
-- Description:
--   1. RLS policies on users & user_roles for self-profile and role reads.
--   2. public.resolve_login_email RPC for School ID login resolution.
--   3. Hardened officer_issue_activation_code with appointment & student status validation.
--   4. Clear public.validate_activation_code RPC distinguishing all failure modes.
--   5. Secure public.activate_student_account enforcing auth.uid() identity binding.
--   6. Hardened public.sync_push_batch with nested payment unwrapping & accurate reversal updates.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ROW LEVEL SECURITY POLICIES FOR USERS & USER_ROLES
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_roles ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to view their own user account record
DROP POLICY IF EXISTS "Users view own record" ON public.users;
CREATE POLICY "Users view own record" ON public.users
  FOR SELECT USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL
    )
  );

-- Allow authenticated users to view their own roles
DROP POLICY IF EXISTS "Users view own roles" ON public.user_roles;
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() AND role = 'DEVADMIN' AND revoked_at IS NULL
    )
  );

-- Allow DevAdmin to manage user_roles
DROP POLICY IF EXISTS "DevAdmin manages user_roles" ON public.user_roles;
CREATE POLICY "DevAdmin manages user_roles" ON public.user_roles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = auth.uid() AND role = 'DEVADMIN' AND revoked_at IS NULL
    )
  );

-- ------------------------------------------------------------------------------
-- 2. LOGIN IDENTIFIER RESOLUTION RPC (School ID or Username -> Auth Email)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_clean TEXT;
  v_email TEXT;
BEGIN
  v_clean := lower(trim(coalesce(p_identifier, '')));
  IF v_clean = '' THEN
    RETURN NULL;
  END IF;

  -- If already an email, return directly
  IF v_clean LIKE '%@%' THEN
    RETURN v_clean;
  END IF;

  -- Match against users.username or students.school_id
  SELECT au.email INTO v_email
  FROM auth.users au
  JOIN public.users u ON u.id = au.id
  LEFT JOIN public.students s ON s.id = u.student_id
  WHERE lower(u.username) = v_clean
     OR (s.school_id IS NOT NULL AND (
       lower(s.school_id) = v_clean 
       OR replace(lower(s.school_id), '-', '') = replace(v_clean, '-', '')
     ))
  LIMIT 1;

  RETURN v_email;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_login_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. OFFICER ACTIVATION CODE ISSUANCE RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.officer_issue_activation_code(
  p_student_id TEXT,
  p_token_hash TEXT,
  p_expires_hours INT DEFAULT 48
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role RECORD;
  v_student RECORD;
  v_student_uuid UUID;
  v_new_claim_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_action TEXT := 'ISSUED';
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  -- Verify caller role
  SELECT role INTO v_caller_role 
  FROM public.user_roles 
  WHERE user_id = v_caller_id 
    AND role IN ('DEVADMIN', 'OFFICER') 
    AND revoked_at IS NULL 
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 ELSE 2 END
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Only officers and administrators can issue activation codes.');
  END IF;

  -- If OFFICER, verify active appointment
  IF v_caller_role.role = 'OFFICER' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.officer_appointments
      WHERE user_id = v_caller_id
        AND status = 'ACTIVE'
        AND suspended_at IS NULL
        AND revoked_at IS NULL
        AND appointment_start <= now()
        AND appointment_end >= now()
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Officer appointment is inactive, suspended, or expired.');
    END IF;
  END IF;

  -- Resolve student by UUID or school_id
  IF p_student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_student FROM public.students WHERE id = p_student_id::uuid;
  ELSE
    SELECT * INTO v_student FROM public.students 
    WHERE lower(school_id) = lower(trim(p_student_id))
       OR replace(lower(school_id), '-', '') = replace(lower(trim(p_student_id)), '-', '')
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', format('Student record %s not found.', p_student_id));
  END IF;

  IF v_student.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student is inactive and ineligible for activation code issuance.');
  END IF;

  v_student_uuid := v_student.id;

  -- Check if already activated
  IF EXISTS (SELECT 1 FROM public.users WHERE student_id = v_student_uuid AND account_status = 'ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student account is already activated.');
  END IF;

  -- Revoke any existing pending claims (reissue invalidates previous)
  IF EXISTS (
    SELECT 1 FROM public.activation_claims 
    WHERE student_id = v_student_uuid AND used_at IS NULL AND revoked_at IS NULL
  ) THEN
    UPDATE public.activation_claims 
    SET revoked_at = now() 
    WHERE student_id = v_student_uuid AND used_at IS NULL AND revoked_at IS NULL;
    v_action := 'REISSUED';
  END IF;

  v_expires_at := now() + (coalesce(p_expires_hours, 48) || ' hours')::INTERVAL;
  v_new_claim_id := gen_random_uuid();

  -- Insert claim (plaintext code is NEVER stored)
  INSERT INTO public.activation_claims (
    id, student_id, token_hash, issued_by_user_id, expires_at, created_at, attempt_count, max_attempts
  ) VALUES (
    v_new_claim_id, v_student_uuid, p_token_hash, v_caller_id, v_expires_at, now(), 0, 5
  );

  INSERT INTO public.activation_claims_audit (
    claim_id, student_id, action, performed_by_user_id, notes
  ) VALUES (
    v_new_claim_id, v_student_uuid, v_action, v_caller_id, format('Code %s with expiration in %s hours', lower(v_action), coalesce(p_expires_hours, 48))
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_new_claim_id,
    'expires_at', v_expires_at,
    'action', v_action,
    'student_id', v_student_uuid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.officer_issue_activation_code(TEXT, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.officer_issue_activation_code(TEXT, TEXT, INT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. PUBLIC STUDENT ACTIVATION PRE-VALIDATION RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_activation_code(
  p_school_id TEXT,
  p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_claim RECORD;
  v_clean_school_id TEXT;
BEGIN
  v_clean_school_id := trim(coalesce(p_school_id, ''));
  IF v_clean_school_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'School ID is required.');
  END IF;

  -- 1. Check student master record
  SELECT * INTO v_student 
  FROM public.students 
  WHERE (
    lower(school_id) = lower(v_clean_school_id)
    OR replace(lower(school_id), '-', '') = replace(lower(v_clean_school_id), '-', '')
    OR id::text = v_clean_school_id
  )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student record not found for this School ID.');
  END IF;

  IF v_student.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student account is currently inactive. Please contact an officer.');
  END IF;

  -- 2. Check if student already has an active account
  IF EXISTS (SELECT 1 FROM public.users WHERE student_id = v_student.id AND account_status = 'ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This student record has already been activated. Please sign in.');
  END IF;

  -- 3. Check for active activation claim
  SELECT * INTO v_claim 
  FROM public.activation_claims 
  WHERE student_id = v_student.id 
    AND used_at IS NULL 
    AND revoked_at IS NULL
  ORDER BY created_at DESC 
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active activation code found for this student. Please request one from an officer.');
  END IF;

  -- 4. Check attempts
  IF v_claim.attempt_count >= v_claim.max_attempts THEN
    RETURN jsonb_build_object('success', false, 'error', 'Activation code revoked due to excessive failed attempts. Please request a new one from an officer.');
  END IF;

  -- 5. Check expiration
  IF v_claim.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This activation code has expired. Please request a new one from an officer.');
  END IF;

  -- 6. Check token hash match
  IF v_claim.token_hash <> p_token_hash THEN
    RETURN jsonb_build_object('success', false, 'error', 'Incorrect activation code. Please check your code and try again.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student.id,
    'school_id', v_student.school_id,
    'student_name', trim(v_student.first_name || ' ' || coalesce(v_student.last_name, ''))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_activation_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_activation_code(TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. ATOMIC STUDENT ACCOUNT ACTIVATION RPC (Enforces Authenticated Identity)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_student_account(
  p_school_id TEXT,
  p_token_hash TEXT,
  p_auth_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_target_user_id UUID;
  v_student RECORD;
  v_claim RECORD;
  v_existing_claim_user RECORD;
  v_clean_school_id TEXT;
  v_is_admin BOOLEAN := FALSE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required for activation.');
  END IF;

  -- Security check: callers may only activate for themselves unless DEVADMIN
  IF p_auth_user_id IS NOT NULL AND p_auth_user_id <> v_caller_id THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles 
      WHERE user_id = v_caller_id AND role = 'DEVADMIN' AND revoked_at IS NULL
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Cannot activate an account for another user.');
    END IF;
    v_target_user_id := p_auth_user_id;
  ELSE
    v_target_user_id := v_caller_id;
  END IF;

  v_clean_school_id := trim(coalesce(p_school_id, ''));

  -- 1. Verify student exists and is active
  SELECT * INTO v_student 
  FROM public.students 
  WHERE (
    lower(school_id) = lower(v_clean_school_id)
    OR replace(lower(school_id), '-', '') = replace(lower(v_clean_school_id), '-', '')
    OR id::text = v_clean_school_id
  )
    AND status = 'ACTIVE'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Active student record not found for this School ID.');
  END IF;

  -- 2. Check if student already linked to another account
  SELECT * INTO v_existing_claim_user 
  FROM public.users 
  WHERE student_id = v_student.id 
    AND account_status = 'ACTIVE';

  IF FOUND THEN
    IF v_existing_claim_user.id = v_target_user_id THEN
      -- Idempotent success
      RETURN jsonb_build_object(
        'success', true, 
        'already_linked', true,
        'student_id', v_student.id,
        'school_id', v_student.school_id,
        'first_name', v_student.first_name,
        'last_name', v_student.last_name
      );
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'This student record has already been claimed by another account.');
    END IF;
  END IF;

  -- 3. Prevent caller account from claiming multiple student records
  IF EXISTS (
    SELECT 1 FROM public.users 
    WHERE id = v_target_user_id AND student_id IS NOT NULL AND student_id <> v_student.id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account is already linked to another student record.');
  END IF;

  -- 4. Find active claim with row-level lock
  SELECT * INTO v_claim 
  FROM public.activation_claims 
  WHERE student_id = v_student.id 
    AND used_at IS NULL 
    AND revoked_at IS NULL
  ORDER BY created_at DESC 
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active activation code found for this student.');
  END IF;

  IF v_claim.attempt_count >= v_claim.max_attempts THEN
    UPDATE public.activation_claims SET revoked_at = now() WHERE id = v_claim.id;
    INSERT INTO public.activation_claims_audit (claim_id, student_id, action, notes)
    VALUES (v_claim.id, v_student.id, 'REVOKED', 'Exceeded maximum failed activation attempts');
    RETURN jsonb_build_object('success', false, 'error', 'Too many failed activation attempts. Code revoked.');
  END IF;

  IF v_claim.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This activation code has expired.');
  END IF;

  -- 5. Validate token hash
  IF v_claim.token_hash <> p_token_hash THEN
    UPDATE public.activation_claims 
    SET attempt_count = attempt_count + 1, 
        last_attempt_at = now() 
    WHERE id = v_claim.id;

    INSERT INTO public.activation_claims_audit (claim_id, student_id, action, notes)
    VALUES (v_claim.id, v_student.id, 'ATTEMPT_FAILED', format('Incorrect token hash attempt %s of %s', v_claim.attempt_count + 1, v_claim.max_attempts));

    IF v_claim.attempt_count + 1 >= v_claim.max_attempts THEN
      UPDATE public.activation_claims SET revoked_at = now() WHERE id = v_claim.id;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code.');
  END IF;

  -- 6. Upsert public.users link FIRST so foreign key constraints on claimed_by_user_id are satisfied
  INSERT INTO public.users (id, username, student_id, account_status, created_at, updated_at)
  VALUES (v_target_user_id, lower(v_student.school_id), v_student.id, 'ACTIVE', now(), now())
  ON CONFLICT (id) DO UPDATE SET
    student_id = EXCLUDED.student_id,
    username = EXCLUDED.username,
    account_status = 'ACTIVE',
    updated_at = now();

  -- 7. Atomically consume claim
  UPDATE public.activation_claims 
  SET used_at = now(), 
      claimed_by_user_id = v_target_user_id 
  WHERE id = v_claim.id;

  -- 8. Assign STUDENT role
  INSERT INTO public.user_roles (id, user_id, role, assigned_at)
  VALUES (gen_random_uuid(), v_target_user_id, 'STUDENT', now())
  ON CONFLICT DO NOTHING;

  -- 9. Audit event
  INSERT INTO public.activation_claims_audit (claim_id, student_id, action, performed_by_user_id, notes)
  VALUES (v_claim.id, v_student.id, 'CLAIMED', v_target_user_id, 'Student self-registration completed');

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student.id,
    'school_id', v_student.school_id,
    'first_name', v_student.first_name,
    'last_name', v_student.last_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_student_account(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_student_account(TEXT, TEXT, UUID) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. HARDENED PUSH BATCH RPC (Supports nested payments and accurate reversals)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_push_batch(p_operations jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_rec RECORD;
  v_role TEXT;
  v_officer_appt RECORD;
  v_op JSONB;
  v_entity_type TEXT;
  v_operation TEXT;
  v_payload JSONB;
  v_entity_id TEXT;
  v_outbox_id TEXT;
  v_results JSONB := '[]'::jsonb;
  v_applied INT := 0;
  v_failed INT := 0;
  v_scan_res JSONB;
  v_revoke_res JSONB;
  v_has_finance_perm BOOLEAN := false;

  -- Payment unwrapping variables
  v_pay_obj JSONB;
  v_alloc_arr JSONB;
  v_alloc_elem JSONB;
  v_pay_id UUID;
  v_payment_found BOOLEAN;
BEGIN
  -- Strict caller verification (Fail-closed)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_user_rec FROM public.users WHERE id = v_user_id;
  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Caller account is suspended or inactive.';
  END IF;

  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User has no active roles.';
  END IF;

  IF v_role = 'STUDENT' THEN
    RAISE EXCEPTION 'Unauthorized: Student role cannot push administrative records.';
  END IF;

  -- Officers must possess an active appointment
  IF v_role = 'OFFICER' THEN
    SELECT * INTO v_officer_appt
    FROM public.officer_appointments
    WHERE user_id = v_user_id
      AND status = 'ACTIVE'
      AND suspended_at IS NULL
      AND revoked_at IS NULL
      AND appointment_start <= now()
      AND appointment_end >= now()
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unauthorized: Officer appointment is inactive, suspended, or expired.';
    END IF;

    IF v_officer_appt.permission_preset IN ('FINANCE', 'FULL')
       OR (v_officer_appt.custom_permissions IS NOT NULL AND (
          v_officer_appt.custom_permissions ? 'FINANCE' OR v_officer_appt.custom_permissions ? 'finance'
       )) THEN
      v_has_finance_perm := true;
    END IF;
  ELSE
    -- DEVADMIN has all permissions
    v_has_finance_perm := true;
  END IF;

  IF p_operations IS NULL OR jsonb_array_length(p_operations) = 0 THEN
    RETURN jsonb_build_object('success', true, 'applied_count', 0, 'failed_count', 0, 'results', '[]'::jsonb);
  END IF;

  FOR v_op IN SELECT * FROM jsonb_array_elements(p_operations)
  LOOP
    v_outbox_id   := v_op->>'id';
    v_operation   := v_op->>'operation';
    v_payload     := v_op->'payload';
    v_entity_id   := v_op->>'entity_id';
    v_entity_type := v_op->>'entity_type';

    BEGIN
      -- 1. ATTENDANCE (CREATE / UPDATE)
      IF v_entity_type = 'ATTENDANCE' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        v_scan_res := public.record_attendance_scan(
          (v_payload->>'occurrence_id')::uuid,
          (v_payload->>'student_id')::uuid,
          CASE WHEN v_payload->>'nfc_card_id' IS NOT NULL THEN (v_payload->>'nfc_card_id')::uuid ELSE NULL END,
          v_payload->>'uid_normalized',
          v_payload->>'status',
          coalesce(v_payload->>'device_id', 'outbox_push'),
          v_outbox_id,
          CASE WHEN v_payload->>'client_scanned_at' IS NOT NULL THEN (v_payload->>'client_scanned_at')::timestamptz ELSE NULL END,
          coalesce(v_payload->>'method', 'NFC'),
          coalesce((v_payload->>'photo_checked')::int, 0),
          v_payload->>'notes'
        );

        IF (v_scan_res->>'status') = 'RECORDED' THEN
          v_applied := v_applied + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED', 'scan_result', v_scan_res);
        ELSIF (v_scan_res->>'status') = 'ALREADY_RECORDED' THEN
          v_applied := v_applied + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'ALREADY_RECORDED', 'scan_result', v_scan_res);
        ELSIF (v_scan_res->>'status') = 'REVOKED_REVIEW_REQUIRED' THEN
          INSERT INTO public.sync_conflicts (
            device_id, entity_type, entity_id, conflict_type, client_payload, server_payload
          ) VALUES (
            coalesce(v_op->>'device_id', 'outbox_push'), 'ATTENDANCE', v_entity_id::uuid,
            'REVOKED_REVIEW_REQUIRED', v_payload, v_scan_res
          );
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REVIEW_REQUIRED', 'scan_result', v_scan_res);
        ELSIF (v_scan_res->>'status') IN ('NOT_ELIGIBLE', 'INVALID_CARD', 'CARD_STUDENT_MISMATCH', 'OCCURRENCE_CLOSED', 'FORBIDDEN_SCOPE', 'UNAUTHORIZED') THEN
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', v_scan_res->>'message');
        ELSE
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'RETRY_PENDING', 'error', v_scan_res->>'message');
        END IF;
        CONTINUE;

      -- 2. ATTENDANCE (VOID / REVOKE)
      ELSIF v_entity_type = 'ATTENDANCE' AND v_operation IN ('VOID', 'REVOKE') THEN
        IF v_payload->>'version' IS NULL THEN
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', 'Version is required for attendance revocation.');
          CONTINUE;
        END IF;

        v_revoke_res := public.revoke_attendance(
          v_entity_id::uuid,
          coalesce(v_payload->>'revocation_reason', v_payload->>'void_reason', 'Offline officer revocation'),
          (v_payload->>'version')::int,
          v_outbox_id
        );

        IF (v_revoke_res->>'success')::boolean = true OR (v_revoke_res->>'status') = 'ALREADY_REVOKED' THEN
          v_applied := v_applied + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED', 'revoke_result', v_revoke_res);
        ELSIF (v_revoke_res->>'status') = 'STALE_STATE_CONFLICT' THEN
          INSERT INTO public.sync_conflicts (
            device_id, entity_type, entity_id, conflict_type, client_payload, server_payload
          ) VALUES (
            coalesce(v_op->>'device_id', 'outbox_push'), 'ATTENDANCE', v_entity_id::uuid,
            'STALE_STATE_CONFLICT', v_payload, v_revoke_res
          );
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REVIEW_REQUIRED', 'revoke_result', v_revoke_res);
        ELSE
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', coalesce(v_revoke_res->>'error', v_revoke_res->>'message'));
        END IF;
        CONTINUE;

      -- 3. ATTENDANCE_ATTEMPT
      ELSIF v_entity_type = 'ATTENDANCE_ATTEMPT' AND v_operation = 'CREATE' THEN
        INSERT INTO public.attendance_attempts (
          id, occurrence_id, card_uid, student_id, actor_user_id,
          result, reason, attempted_at
        ) VALUES (
          v_entity_id::uuid,
          (v_payload->>'occurrence_id')::uuid,
          v_payload->>'card_uid',
          CASE WHEN v_payload->>'student_id' IS NOT NULL THEN (v_payload->>'student_id')::uuid ELSE NULL END,
          v_user_id,
          coalesce(v_payload->>'result', 'ACCEPTED'),
          v_payload->>'reason',
          coalesce((v_payload->>'attempted_at')::timestamptz, now())
        ) ON CONFLICT (id) DO NOTHING;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 4. STUDENT MASTER
      ELSIF v_entity_type = 'STUDENT' THEN
        IF v_operation = 'CREATE' THEN
          INSERT INTO public.students (
            id, school_id, first_name, middle_name, last_name,
            photo_storage_path, status, created_at, updated_at
          ) VALUES (
            v_entity_id::uuid,
            v_payload->>'school_id',
            v_payload->>'first_name',
            v_payload->>'middle_name',
            v_payload->>'last_name',
            v_payload->>'photo_storage_path',
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO UPDATE SET
            first_name = EXCLUDED.first_name,
            middle_name = EXCLUDED.middle_name,
            last_name = EXCLUDED.last_name,
            updated_at = now();
        ELSIF v_operation = 'UPDATE' THEN
          UPDATE public.students
          SET photo_local_uri = coalesce(v_payload->>'photo_local_uri', photo_local_uri),
              photo_storage_path = coalesce(v_payload->>'photo_storage_path', photo_storage_path),
              updated_at = now()
          WHERE id = v_entity_id::uuid;
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 5. ENROLLMENT
      ELSIF v_entity_type = 'ENROLLMENT' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO public.student_enrollments (
          id, student_id, semester_id, program_id, year_level, section, section_id,
          enrollment_status, first_name_snapshot, middle_name_snapshot, last_name_snapshot,
          updated_at
        ) VALUES (
          v_entity_id::uuid,
          (v_payload->>'student_id')::uuid,
          v_payload->>'semester_id',
          v_payload->>'program_id',
          coalesce((v_payload->>'year_level')::int, 1),
          coalesce(v_payload->>'section', ''),
          CASE WHEN v_payload->>'section_id' IS NOT NULL THEN (v_payload->>'section_id')::uuid ELSE NULL END,
          coalesce(v_payload->>'enrollment_status', v_payload->>'status', 'ENROLLED'),
          coalesce(v_payload->>'first_name_snapshot', ''),
          v_payload->>'middle_name_snapshot',
          coalesce(v_payload->>'last_name_snapshot', ''),
          now()
        ) ON CONFLICT (id) DO UPDATE SET
          program_id = EXCLUDED.program_id,
          year_level = EXCLUDED.year_level,
          section = EXCLUDED.section,
          section_id = EXCLUDED.section_id,
          enrollment_status = EXCLUDED.enrollment_status,
          updated_at = now();

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 6. NFC CARD
      ELSIF v_entity_type = 'CARD' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO public.nfc_cards (
          id, student_id, uid_normalized, status, assigned_at,
          note, updated_at
        ) VALUES (
          v_entity_id::uuid,
          (v_payload->>'student_id')::uuid,
          v_payload->>'uid_normalized',
          coalesce(v_payload->>'status', 'ACTIVE'),
          coalesce((v_payload->>'assigned_at')::timestamptz, now()),
          coalesce(v_payload->>'note', v_payload->>'notes'),
          now()
        ) ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          updated_at = now();

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 7. EVENT, EVENT_CATEGORY, OCCURRENCE, PARTICIPANT
      ELSIF v_entity_type = 'EVENT' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO public.events (
          id, title, category_id, semester_id, event_type,
          audience_type, audience_json, attendance_required, status, created_at, updated_at
        ) VALUES (
          v_entity_id::uuid,
          v_payload->>'title',
          CASE WHEN v_payload->>'category_id' IS NOT NULL THEN (v_payload->>'category_id')::uuid ELSE NULL END,
          v_payload->>'semester_id',
          coalesce(v_payload->>'event_type', 'GENERAL'),
          coalesce(v_payload->>'audience_type', 'ALL'),
          v_payload->'audience_json',
          coalesce((v_payload->>'attendance_required')::int, 1),
          coalesce(v_payload->>'status', 'ACTIVE'),
          coalesce((v_payload->>'created_at')::timestamptz, now()),
          now()
        ) ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category_id = EXCLUDED.category_id,
          status = EXCLUDED.status,
          updated_at = now();

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'EVENT_CATEGORY' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO public.event_categories (id, name, description, code, status, created_at, updated_at)
        VALUES (
          v_entity_id::uuid,
          v_payload->>'name',
          v_payload->>'description',
          v_payload->>'code',
          coalesce(v_payload->>'status', 'ACTIVE'),
          coalesce((v_payload->>'created_at')::timestamptz, now()),
          now()
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          updated_at = now();

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'OCCURRENCE' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO public.event_occurrences (
          id, event_id, title, occurs_on, starts_at, ends_at, grace_minutes,
          status, updated_at
        ) VALUES (
          v_entity_id::uuid,
          (v_payload->>'event_id')::uuid,
          coalesce(v_payload->>'title', 'Session'),
          (v_payload->>'occurs_on')::date,
          (v_payload->>'starts_at')::time,
          (v_payload->>'ends_at')::time,
          coalesce((v_payload->>'grace_minutes')::int, 15),
          coalesce(v_payload->>'status', 'SCHEDULED'),
          now()
        ) ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          updated_at = now();

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'PARTICIPANT' AND v_operation = 'CREATE' THEN
        INSERT INTO public.event_participants (
          id, occurrence_id, student_id, attendance_required, excused, excuse_reason, excused_by_user_id, updated_at
        ) VALUES (
          v_entity_id::uuid,
          (v_payload->>'occurrence_id')::uuid,
          (v_payload->>'student_id')::uuid,
          coalesce((v_payload->>'attendance_required')::int, 1),
          coalesce((v_payload->>'excused')::int, 0),
          v_payload->>'excuse_reason',
          CASE WHEN v_payload->>'excused_by_user_id' IS NOT NULL THEN (v_payload->>'excused_by_user_id')::uuid ELSE NULL END,
          now()
        ) ON CONFLICT (id) DO NOTHING;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 8. FINANCE: OBLIGATION_RULE, OBLIGATION
      ELSIF v_entity_type = 'OBLIGATION_RULE' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        IF NOT v_has_finance_perm THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks finance permissions.';
        END IF;

        INSERT INTO public.obligation_rules (
          id, semester_id, name, type, trigger_type, default_amount_centavos, status, created_at, updated_at
        ) VALUES (
          v_entity_id::uuid,
          v_payload->>'semester_id',
          v_payload->>'name',
          coalesce(v_payload->>'type', 'FINE'),
          coalesce(v_payload->>'trigger_type', 'MANUAL'),
          coalesce((v_payload->>'default_amount_centavos')::bigint, 0),
          coalesce(v_payload->>'status', 'ACTIVE'),
          coalesce((v_payload->>'created_at')::timestamptz, now()),
          now()
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          default_amount_centavos = EXCLUDED.default_amount_centavos,
          status = EXCLUDED.status,
          updated_at = now();

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'OBLIGATION' THEN
        IF NOT v_has_finance_perm THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks finance permissions.';
        END IF;

        IF v_operation = 'CREATE' OR v_operation = 'UPDATE' THEN
          INSERT INTO public.student_obligations (
            id, student_id, rule_id, semester_id, title, type,
            amount_centavos, status, due_date, issued_at, updated_at
          ) VALUES (
            v_entity_id::uuid,
            (v_payload->>'student_id')::uuid,
            CASE WHEN v_payload->>'rule_id' IS NOT NULL THEN (v_payload->>'rule_id')::uuid ELSE NULL END,
            v_payload->>'semester_id',
            coalesce(v_payload->>'title', 'Student Obligation'),
            coalesce(v_payload->>'type', 'FINE'),
            coalesce((v_payload->>'amount_centavos')::bigint, (v_payload->>'original_amount_centavos')::bigint, 0),
            coalesce(v_payload->>'status', 'UNPAID'),
            CASE WHEN v_payload->>'due_date' IS NOT NULL THEN (v_payload->>'due_date')::date ELSE NULL END,
            coalesce((v_payload->>'issued_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO UPDATE SET
            amount_centavos = EXCLUDED.amount_centavos,
            status = EXCLUDED.status,
            updated_at = now();
        ELSIF v_operation = 'VOID' THEN
          UPDATE public.student_obligations
          SET status = 'VOID', updated_at = now()
          WHERE id = v_entity_id::uuid;
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 9. FINANCE: PAYMENT & PAYMENT_ALLOCATIONS (Handles nested payload & reversals)
      ELSIF v_entity_type = 'PAYMENT' THEN
        IF NOT v_has_finance_perm THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks finance permissions.';
        END IF;

        -- Check if payload is nested: { payment: {...}, allocations: [...] }
        IF v_payload ? 'payment' THEN
          v_pay_obj := v_payload->'payment';
          v_alloc_arr := v_payload->'allocations';
        ELSE
          v_pay_obj := v_payload;
          v_alloc_arr := v_payload->'allocations';
        END IF;

        v_pay_id := coalesce(v_pay_obj->>'id', v_entity_id)::uuid;

        -- CASE A: Payment Reversal
        IF v_operation = 'UPDATE' OR (v_pay_obj->>'status' = 'REVERSED') THEN
          UPDATE public.payments
          SET status = 'REVERSED',
              reversed_at = coalesce((v_pay_obj->>'reversed_at')::timestamptz, now()),
              reversed_by_user_id = v_user_id,
              reversal_reason = coalesce(v_pay_obj->>'reversal_reason', 'Reversed by officer'),
              updated_at = now()
          WHERE id = v_pay_id;

          GET DIAGNOSTICS v_payment_found = ROW_COUNT;
          IF v_payment_found THEN
            v_applied := v_applied + 1;
            v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
          ELSE
            -- Payment row not found on server yet: cannot acknowledge reversal!
            v_failed := v_failed + 1;
            v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'RETRY_PENDING', 'error', 'Payment to reverse not found on server.');
          END IF;
          CONTINUE;
        END IF;

        -- CASE B: Payment Creation
        INSERT INTO public.payments (
          id, student_id, semester_id, reference_number, idempotency_key,
          amount_centavos, source, channel, status, processed_by_user_id,
          processed_at, updated_at
        ) VALUES (
          v_pay_id,
          (v_pay_obj->>'student_id')::uuid,
          v_pay_obj->>'semester_id',
          coalesce(v_pay_obj->>'reference_number', v_pay_obj->>'receipt_number', gen_random_uuid()::text),
          coalesce(v_pay_obj->>'idempotency_key', v_outbox_id),
          coalesce((v_pay_obj->>'amount_centavos')::bigint, (v_pay_obj->>'total_amount_centavos')::bigint, 0),
          coalesce(v_pay_obj->>'source', 'MANUAL'),
          coalesce(v_pay_obj->>'channel', v_pay_obj->>'payment_method', 'CASH'),
          coalesce(v_pay_obj->>'status', 'POSTED'),
          v_user_id,
          coalesce((v_pay_obj->>'processed_at')::timestamptz, now()),
          now()
        ) ON CONFLICT (id) DO NOTHING;

        -- Also process nested allocations if present
        IF v_alloc_arr IS NOT NULL AND jsonb_typeof(v_alloc_arr) = 'array' THEN
          FOR v_alloc_elem IN SELECT * FROM jsonb_array_elements(v_alloc_arr)
          LOOP
            INSERT INTO public.payment_allocations (
              id, payment_id, obligation_id, amount_centavos, created_at
            ) VALUES (
              coalesce(v_alloc_elem->>'id', gen_random_uuid()::text)::uuid,
              v_pay_id,
              (v_alloc_elem->>'obligation_id')::uuid,
              coalesce((v_alloc_elem->>'amount_centavos')::bigint, 0),
              coalesce((v_alloc_elem->>'created_at')::timestamptz, now())
            ) ON CONFLICT (id) DO NOTHING;
          END LOOP;
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 10. ACADEMIC STRUCTURE (DEVADMIN ONLY)
      ELSIF v_entity_type IN ('ACADEMIC_YEAR', 'SEMESTER', 'PROGRAM', 'YEAR_LEVEL', 'SECTION') THEN
        IF v_role <> 'DEVADMIN' THEN
          RAISE EXCEPTION 'Unauthorized: Academic structure updates are restricted to DevAdmin.';
        END IF;

        IF v_entity_type = 'ACADEMIC_YEAR' THEN
          INSERT INTO public.academic_years (id, label, starts_on, ends_on, status, created_at, updated_at)
          VALUES (
            v_entity_id,
            v_payload->>'label',
            (v_payload->>'starts_on')::date,
            (v_payload->>'ends_on')::date,
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            status = EXCLUDED.status,
            updated_at = now();
        ELSIF v_entity_type = 'SEMESTER' THEN
          INSERT INTO public.semesters (id, academic_year_id, term, starts_on, ends_on, status, created_at, updated_at)
          VALUES (
            v_entity_id,
            v_payload->>'academic_year_id',
            v_payload->>'term',
            (v_payload->>'starts_on')::date,
            (v_payload->>'ends_on')::date,
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO UPDATE SET
            term = EXCLUDED.term,
            status = EXCLUDED.status,
            updated_at = now();
        ELSIF v_entity_type = 'PROGRAM' THEN
          INSERT INTO public.programs (id, code, name, status, created_at, updated_at)
          VALUES (
            v_entity_id,
            v_payload->>'code',
            v_payload->>'name',
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            updated_at = now();
        ELSIF v_entity_type = 'YEAR_LEVEL' THEN
          INSERT INTO public.year_levels (id, program_id, year_number, label, status)
          VALUES (
            v_entity_id::uuid,
            v_payload->>'program_id',
            (v_payload->>'year_number')::int,
            v_payload->>'label',
            coalesce(v_payload->>'status', 'ACTIVE')
          ) ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            status = EXCLUDED.status;
        ELSIF v_entity_type = 'SECTION' THEN
          INSERT INTO public.sections (id, year_level_id, name, status)
          VALUES (
            v_entity_id::uuid,
            (v_payload->>'year_level_id')::uuid,
            v_payload->>'name',
            coalesce(v_payload->>'status', 'ACTIVE')
          ) ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            status = EXCLUDED.status;
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSE
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', format('Unsupported entity type: %s', v_entity_type));
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', (v_failed = 0),
    'applied_count', v_applied,
    'failed_count', v_failed,
    'results', v_results
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_push_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_push_batch(jsonb) TO authenticated;

