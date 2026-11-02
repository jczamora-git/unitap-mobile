-- ==============================================================================
-- Migration: 20261103010000_repair_activation_claim_foreign_key_order.sql
-- Description: Fix foreign key constraint violation in activate_student_account.
-- Root cause: activation_claims.claimed_by_user_id has a foreign key referencing
-- public.users(id). The function was attempting to UPDATE activation_claims BEFORE
-- inserting the newly registered auth user into public.users.
-- Solution: Upsert public.users FIRST, then update activation_claims.
-- ==============================================================================

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

