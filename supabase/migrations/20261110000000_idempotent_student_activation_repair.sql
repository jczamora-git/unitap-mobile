-- ==============================================================================
-- Migration: 20261110000000_idempotent_student_activation_repair.sql
-- Description: Harden activate_student_account against duplicate username (23505)
-- and make student activation strictly idempotent and conflict-safe.
-- Prevents users_username_key unique constraint violations when a username
-- or student record is already linked or claimed, providing explicit JSON errors.
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
  v_caller_user RECORD;
  v_existing_student_user RECORD;
  v_conflicting_username_user RECORD;
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

  -- 2. Check if caller already has a public.users row
  SELECT * INTO v_caller_user
  FROM public.users
  WHERE id = v_target_user_id;

  -- 2a. If caller is already correctly linked to this student, return idempotent success
  IF FOUND AND v_caller_user.student_id = v_student.id THEN
    IF v_caller_user.account_status <> 'ACTIVE' THEN
      UPDATE public.users 
      SET account_status = 'ACTIVE', updated_at = now() 
      WHERE id = v_target_user_id;
    END IF;

    INSERT INTO public.user_roles (id, user_id, role, assigned_at)
    VALUES (gen_random_uuid(), v_target_user_id, 'STUDENT', now())
    ON CONFLICT DO NOTHING;

    RETURN jsonb_build_object(
      'success', true, 
      'already_linked', true,
      'student_id', v_student.id,
      'school_id', v_student.school_id,
      'first_name', v_student.first_name,
      'last_name', v_student.last_name
    );
  END IF;

  -- 2b. Prevent caller account from claiming a different student record if already linked
  IF FOUND AND v_caller_user.student_id IS NOT NULL AND v_caller_user.student_id <> v_student.id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account is already linked to another student record.');
  END IF;

  -- 3. Check if this student is already claimed by ANOTHER account
  SELECT * INTO v_existing_student_user
  FROM public.users
  WHERE student_id = v_student.id
    AND id <> v_target_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'This student record has already been claimed by another account. Please sign in or contact an officer.'
    );
  END IF;

  -- 4. Check if the username (school_id) is already registered to ANOTHER account
  SELECT * INTO v_conflicting_username_user
  FROM public.users
  WHERE lower(username) = lower(v_student.school_id)
    AND id <> v_target_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'An account with School ID ' || v_student.school_id || ' already exists. Please sign in or contact an officer for assistance.'
    );
  END IF;

  -- 5. Find active claim with row-level lock
  SELECT * INTO v_claim 
  FROM public.activation_claims 
  WHERE student_id = v_student.id 
    AND used_at IS NULL 
    AND revoked_at IS NULL
  ORDER BY created_at DESC 
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Check if student already has a used claim by this caller (idempotent fallback)
    IF EXISTS (
      SELECT 1 FROM public.activation_claims
      WHERE student_id = v_student.id AND claimed_by_user_id = v_target_user_id
    ) THEN
      RETURN jsonb_build_object(
        'success', true, 
        'already_linked', true,
        'student_id', v_student.id,
        'school_id', v_student.school_id,
        'first_name', v_student.first_name,
        'last_name', v_student.last_name
      );
    END IF;

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

  -- 6. Validate token hash
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

  -- 7. Upsert public.users link with uniqueness guard
  BEGIN
    INSERT INTO public.users (id, username, student_id, account_status, created_at, updated_at)
    VALUES (v_target_user_id, lower(v_student.school_id), v_student.id, 'ACTIVE', now(), now())
    ON CONFLICT (id) DO UPDATE SET
      student_id = EXCLUDED.student_id,
      username = EXCLUDED.username,
      account_status = 'ACTIVE',
      updated_at = now();
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'An account with School ID ' || v_student.school_id || ' already exists. Please sign in or contact an officer.'
    );
  END;

  -- 8. Atomically consume claim
  UPDATE public.activation_claims 
  SET used_at = now(), 
      claimed_by_user_id = v_target_user_id 
  WHERE id = v_claim.id;

  -- 9. Assign STUDENT role
  INSERT INTO public.user_roles (id, user_id, role, assigned_at)
  VALUES (gen_random_uuid(), v_target_user_id, 'STUDENT', now())
  ON CONFLICT DO NOTHING;

  -- 10. Audit event
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

