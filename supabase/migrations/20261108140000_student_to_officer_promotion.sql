-- ==============================================================================
-- Migration: 20261108140000_student_to_officer_promotion.sql
-- Description:
--   Atomic Student-to-Officer Promotion RPC:
--   1. Promotes an existing authenticated student to Officer in a single transaction.
--   2. Prevents duplicate active appointments.
--   3. Automatically resolves user_id from students/users linkage if not passed.
--   4. Assigns the active appointment and OFFICER role in user_roles without altering STUDENT role.
--   5. Strictly enforces DEVADMIN authorization via public.get_current_user_role().
--   6. Does NOT create new Auth accounts or issue activation claim codes.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.devadmin_promote_student_to_officer(
  p_student_id TEXT,
  p_user_id TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_permission_preset TEXT DEFAULT 'FULL',
  p_custom_permissions JSONB DEFAULT '[]'::jsonb,
  p_academic_year_id TEXT DEFAULT NULL,
  p_semester_id TEXT DEFAULT NULL,
  p_appointment_start TIMESTAMPTZ DEFAULT now(),
  p_appointment_end TIMESTAMPTZ DEFAULT (now() + interval '1 year'),
  p_scope_type TEXT DEFAULT 'ORGANIZATION',
  p_scope_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_student public.students%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_student_uuid UUID;
  v_user_uuid UUID;
  v_appt_id UUID;
  v_role_id UUID;
  v_clean_student_id TEXT;
  v_resolved_name TEXT;
  v_resolved_email TEXT;
BEGIN
  -- 1. Authorization: Caller must be authenticated DEVADMIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  v_caller_role := public.get_current_user_role();
  IF coalesce(v_caller_role, '') <> 'DEVADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Only DevAdmin can promote students to officer.');
  END IF;

  -- 2. Resolve Student Record
  v_clean_student_id := trim(coalesce(p_student_id, ''));
  IF v_clean_student_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student identifier is required.');
  END IF;

  IF v_clean_student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_student FROM public.students WHERE id = v_clean_student_id::uuid LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    SELECT * INTO v_student FROM public.students 
    WHERE (
      lower(school_id) = lower(v_clean_student_id)
      OR replace(lower(school_id), '-', '') = replace(lower(v_clean_student_id), '-', '')
    )
    LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student record not found.');
  END IF;

  v_student_uuid := v_student.id;

  -- 3. Resolve Existing Authenticated User Account
  -- 3a. If p_user_id passed as valid UUID, verify in users
  IF p_user_id IS NOT NULL AND trim(p_user_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_user FROM public.users WHERE id = trim(p_user_id)::uuid LIMIT 1;
  END IF;

  -- 3b. If not found by p_user_id, look up by student_id foreign key
  IF v_user.id IS NULL THEN
    SELECT * INTO v_user FROM public.users 
    WHERE student_id = v_student_uuid AND account_status = 'ACTIVE' 
    LIMIT 1;
  END IF;

  -- 3c. If not found, check by username matching school_id
  IF v_user.id IS NULL THEN
    SELECT * INTO v_user FROM public.users 
    WHERE (lower(username) = lower(v_student.school_id) OR replace(lower(username), '-', '') = replace(lower(v_student.school_id), '-', ''))
      AND account_status = 'ACTIVE'
    LIMIT 1;
  END IF;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'No active user account found for student ' || v_student.school_id || '. The student must activate their account before promotion.'
    );
  END IF;

  v_user_uuid := v_user.id;

  -- Ensure student_id on user record is properly linked
  IF v_user.student_id IS NULL OR v_user.student_id <> v_student_uuid THEN
    UPDATE public.users SET student_id = v_student_uuid, updated_at = now() WHERE id = v_user_uuid;
  END IF;

  -- 4. Prevent duplicate active officer appointments
  IF EXISTS (
    SELECT 1 FROM public.officer_appointments
    WHERE (user_id = v_user_uuid OR student_id = v_student_uuid)
      AND status IN ('ACTIVE', 'SUSPENDED')
      AND appointment_end >= now()
      AND revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Student ' || v_student.school_id || ' already has an active officer appointment.'
    );
  END IF;

  -- 5. Prepare Full Name & Email
  v_resolved_name := trim(coalesce(p_full_name, ''));
  IF v_resolved_name = '' THEN
    v_resolved_name := trim(v_student.first_name || ' ' || coalesce(v_student.last_name, ''));
  END IF;

  v_resolved_email := trim(coalesce(p_email, ''));
  IF v_resolved_email = '' OR v_resolved_email NOT LIKE '%@%' THEN
    v_resolved_email := lower(v_student.school_id) || '@univ.edu';
  END IF;

  -- 6. Insert new ACTIVE officer appointment (NO activation code, NO pending status)
  INSERT INTO public.officer_appointments (
    user_id,
    student_id,
    full_name,
    email,
    permission_preset,
    custom_permissions,
    academic_year_id,
    semester_id,
    appointment_start,
    appointment_end,
    scope_type,
    scope_id,
    status,
    assigned_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_user_uuid,
    v_student_uuid,
    v_resolved_name,
    v_resolved_email,
    coalesce(nullif(p_permission_preset, ''), 'FULL'),
    coalesce(p_custom_permissions, '[]'::jsonb),
    p_academic_year_id,
    p_semester_id,
    coalesce(p_appointment_start, now()),
    coalesce(p_appointment_end, now() + interval '1 year'),
    coalesce(nullif(p_scope_type, ''), 'ORGANIZATION'),
    p_scope_id,
    'ACTIVE',
    auth.uid(),
    now(),
    now()
  ) RETURNING id INTO v_appt_id;

  -- 7. Assign OFFICER role in user_roles without altering existing STUDENT role
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user_uuid AND role = 'OFFICER' AND revoked_at IS NULL
  ) THEN
    INSERT INTO public.user_roles (
      user_id,
      role,
      semester_id,
      assigned_by_user_id,
      assigned_at
    ) VALUES (
      v_user_uuid,
      'OFFICER',
      p_semester_id,
      auth.uid(),
      now()
    ) RETURNING id INTO v_role_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appt_id,
    'user_id', v_user_uuid,
    'student_id', v_student_uuid,
    'officer_name', v_resolved_name,
    'status', 'ACTIVE'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.devadmin_promote_student_to_officer(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.devadmin_promote_student_to_officer(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
) TO authenticated;

