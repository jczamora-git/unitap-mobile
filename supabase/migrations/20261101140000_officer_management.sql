-- ============================================================================
-- UniTap 2.0 DevAdmin-Only Officer Management & Multi-Role Appointment Architecture
-- ============================================================================

CREATE TABLE IF NOT EXISTS officer_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  permission_preset VARCHAR(20) NOT NULL DEFAULT 'FULL' CHECK(permission_preset IN ('ATTENDANCE', 'FINANCE', 'FULL', 'CUSTOM')),
  custom_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  academic_year_id TEXT,
  semester_id TEXT,
  appointment_start TIMESTAMPTZ NOT NULL,
  appointment_end TIMESTAMPTZ NOT NULL,
  scope_type VARCHAR(20) NOT NULL DEFAULT 'ORGANIZATION' CHECK(scope_type IN ('ORGANIZATION', 'PROGRAM', 'SECTION', 'EVENT')),
  scope_id UUID,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('ACTIVE', 'PENDING', 'SUSPENDED', 'REVOKED')),
  invitation_code TEXT,
  invitation_sent_at TIMESTAMPTZ,
  assigned_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  suspended_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_officer_appts_user ON officer_appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_officer_appts_student ON officer_appointments(student_id);
CREATE INDEX IF NOT EXISTS idx_officer_appts_status ON officer_appointments(status);
CREATE INDEX IF NOT EXISTS idx_officer_appts_term ON officer_appointments(semester_id);

-- Enable RLS
ALTER TABLE officer_appointments ENABLE ROW LEVEL SECURITY;

-- Helper to check if current caller is DEVADMIN
CREATE OR REPLACE FUNCTION is_caller_devadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid()
      AND role = 'DEVADMIN'
      AND revoked_at IS NULL
  );
$$;

-- RLS Policies
CREATE POLICY "DevAdmin full access on officer_appointments"
  ON officer_appointments
  FOR ALL
  TO authenticated
  USING (is_caller_devadmin())
  WITH CHECK (is_caller_devadmin());

CREATE POLICY "Officers view own appointment"
  ON officer_appointments
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() AND status IN ('ACTIVE', 'SUSPENDED'));

-- DevAdmin RPC to assign officer to existing student or user
CREATE OR REPLACE FUNCTION devadmin_assign_officer(
  p_user_id UUID,
  p_student_id UUID,
  p_full_name TEXT,
  p_email TEXT,
  p_permission_preset TEXT,
  p_custom_permissions JSONB,
  p_academic_year_id UUID,
  p_semester_id UUID,
  p_appointment_start TIMESTAMPTZ,
  p_appointment_end TIMESTAMPTZ,
  p_scope_type TEXT,
  p_scope_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id UUID;
  v_appt_id UUID;
  v_role_id UUID;
BEGIN
  v_caller_id := auth.uid();
  IF NOT is_caller_devadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Only DevAdmin can assign officers.');
  END IF;

  -- Insert appointment
  INSERT INTO officer_appointments (
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
    p_user_id,
    p_student_id,
    p_full_name,
    p_email,
    p_permission_preset,
    COALESCE(p_custom_permissions, '[]'::jsonb),
    p_academic_year_id,
    p_semester_id,
    p_appointment_start,
    p_appointment_end,
    p_scope_type,
    p_scope_id,
    CASE WHEN p_user_id IS NOT NULL THEN 'ACTIVE' ELSE 'PENDING' END,
    v_caller_id,
    now(),
    now()
  ) RETURNING id INTO v_appt_id;

  -- If user exists, assign OFFICER role in user_roles without deleting existing STUDENT role
  IF p_user_id IS NOT NULL THEN
    -- Check if active OFFICER role already exists
    IF NOT EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = p_user_id AND role = 'OFFICER' AND revoked_at IS NULL
    ) THEN
      INSERT INTO user_roles (
        user_id,
        role,
        semester_id,
        assigned_by_user_id,
        assigned_at
      ) VALUES (
        p_user_id,
        'OFFICER',
        p_semester_id,
        v_caller_id,
        now()
      ) RETURNING id INTO v_role_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appt_id,
    'status', CASE WHEN p_user_id IS NOT NULL THEN 'ACTIVE' ELSE 'PENDING' END
  );
END;
$$;

-- DevAdmin RPC to suspend officer
CREATE OR REPLACE FUNCTION devadmin_suspend_officer(
  p_appointment_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT is_caller_devadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Only DevAdmin can suspend officers.');
  END IF;

  UPDATE officer_appointments
  SET status = 'SUSPENDED',
      suspended_at = now(),
      updated_at = now()
  WHERE id = p_appointment_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- DevAdmin RPC to revoke officer access
CREATE OR REPLACE FUNCTION devadmin_revoke_officer(
  p_appointment_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT is_caller_devadmin() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Only DevAdmin can revoke officers.');
  END IF;

  SELECT user_id INTO v_user_id
  FROM officer_appointments
  WHERE id = p_appointment_id;

  UPDATE officer_appointments
  SET status = 'REVOKED',
      revoked_at = now(),
      updated_at = now()
  WHERE id = p_appointment_id;

  -- Revoke officer role in user_roles, preserving student role completely
  IF v_user_id IS NOT NULL THEN
    UPDATE user_roles
    SET revoked_at = now()
    WHERE user_id = v_user_id AND role = 'OFFICER' AND revoked_at IS NULL;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

