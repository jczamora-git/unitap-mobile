-- ==============================================================================
-- Migration: 20261108120000_harden_officer_activation_status.sql
-- Description:
--   Hardens public.officer_get_student_activation_status RPC:
--   1. Enforces DEVADMIN and OFFICER role authorization via public.get_current_user_role().
--   2. Resolves PostgreSQL error 42703 by mapping audit timestamp to a.created_at (not a.performed_at).
--   3. Uses explicit table %ROWTYPE declarations to prevent unassigned record access errors.
--   4. Preserves flexible UUID and canonical/hyphen-agnostic School ID lookup.
--   5. Restricts execution privileges to authenticated users only; revokes PUBLIC and anon.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.officer_get_student_activation_status(
  p_student_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_student_uuid UUID;
  v_user public.users%ROWTYPE;
  v_claim public.activation_claims%ROWTYPE;
  v_status TEXT := 'NOT_ACTIVATED';
  v_clean_id TEXT;
  v_audit JSONB := '[]'::jsonb;
BEGIN
  -- 0. Authorization check: DEVADMIN or OFFICER
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF coalesce(public.get_current_user_role(), '') NOT IN ('DEVADMIN', 'OFFICER') THEN
    RAISE EXCEPTION 'Unauthorized: Officer or DevAdmin privileges required.';
  END IF;

  v_clean_id := trim(coalesce(p_student_id, ''));
  IF v_clean_id = '' THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'error', 'Student identifier is required.');
  END IF;

  -- 1. Try finding student by UUID if input is formatted as UUID
  IF v_clean_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_student FROM public.students WHERE id = v_clean_id::uuid LIMIT 1;
  END IF;

  -- 2. If not found by UUID, search by canonical/flexible School ID
  IF v_student.id IS NULL THEN
    SELECT * INTO v_student FROM public.students 
    WHERE (
      lower(school_id) = lower(v_clean_id)
      OR replace(lower(school_id), '-', '') = replace(lower(v_clean_id), '-', '')
      OR id::text = v_clean_id
    )
    LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'error', 'Student record not found.');
  END IF;

  v_student_uuid := v_student.id;

  -- 3. Check public.users for active student account linkage
  SELECT * INTO v_user FROM public.users 
  WHERE student_id = v_student_uuid AND account_status = 'ACTIVE'
  LIMIT 1;

  IF FOUND THEN
    v_status := 'ACTIVATED';
  ELSE
    -- 4. Check latest activation claim
    SELECT * INTO v_claim 
    FROM public.activation_claims 
    WHERE student_id = v_student_uuid 
    ORDER BY created_at DESC 
    LIMIT 1;

    IF FOUND THEN
      IF v_claim.used_at IS NOT NULL THEN
        v_status := 'ACTIVATED';
      ELSIF v_claim.revoked_at IS NOT NULL OR coalesce(v_claim.attempt_count, 0) >= coalesce(v_claim.max_attempts, 5) THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSIF v_claim.expires_at < now() THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSE
        v_status := 'ACTIVATION_PENDING';
      END IF;
    ELSE
      v_status := 'NOT_ACTIVATED';
    END IF;
  END IF;

  -- 5. Collect audit trail (using valid column a.created_at)
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'action', a.action,
      'performed_at', a.created_at,
      'notes', a.notes
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_audit
  FROM public.activation_claims_audit a
  WHERE a.student_id = v_student_uuid;

  RETURN jsonb_build_object(
    'status', v_status,
    'student_id', v_student_uuid,
    'school_id', v_student.school_id,
    'claim_id', v_claim.id,
    'expires_at', v_claim.expires_at,
    'attempt_count', coalesce(v_claim.attempt_count, 0),
    'max_attempts', coalesce(v_claim.max_attempts, 5),
    'linked_user_id', v_user.id,
    'linked_username', v_user.username,
    'audit_history', v_audit
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.officer_get_student_activation_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.officer_get_student_activation_status(TEXT) TO authenticated;

