-- ============================================================================
-- UniTap 2.0: Student Self-Registration, Activation Claims & Row Level Security
-- ============================================================================

-- 1. Unique 1-to-1 constraint between auth identity and student record
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student_id 
  ON users(student_id) 
  WHERE student_id IS NOT NULL;

-- 2. Enhance activation_claims table with rate limiting and claim tracking
ALTER TABLE activation_claims 
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS claimed_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- 3. Activation claims audit log
CREATE TABLE IF NOT EXISTS activation_claims_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id UUID REFERENCES activation_claims(id) ON DELETE SET NULL,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL, -- 'ISSUED', 'REISSUED', 'REVOKED', 'ATTEMPT_FAILED', 'CLAIMED'
  performed_by_user_id UUID REFERENCES users(id),
  ip_or_device TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activation_claims_audit_student 
  ON activation_claims_audit(student_id);

-- 4. Atomic Server-Side Student Account Activation RPC Function
CREATE OR REPLACE FUNCTION activate_student_account(
  p_school_id TEXT,
  p_token_hash TEXT,
  p_auth_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_student RECORD;
  v_claim RECORD;
  v_user_id UUID;
  v_existing_claim_user RECORD;
  v_clean_school_id TEXT;
BEGIN
  v_user_id := coalesce(p_auth_user_id, auth.uid());
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required for activation.');
  END IF;

  v_clean_school_id := trim(p_school_id);

  -- 1. Verify student exists and is ACTIVE
  SELECT * INTO v_student 
  FROM students 
  WHERE lower(school_id) = lower(v_clean_school_id) 
    AND status = 'ACTIVE';

  IF NOT FOUND THEN
    -- Generic failure message to prevent student ID enumeration
    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code or school ID.');
  END IF;

  -- 2. Verify student is not already claimed
  SELECT * INTO v_existing_claim_user 
  FROM users 
  WHERE student_id = v_student.id 
    AND account_status = 'ACTIVE';

  IF FOUND THEN
    IF v_existing_claim_user.id = v_user_id THEN
      RETURN jsonb_build_object(
        'success', true, 
        'already_linked', true,
        'student_id', v_student.id,
        'school_id', v_student.school_id,
        'first_name', v_student.first_name,
        'last_name', v_student.last_name
      );
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'This student record has already been activated. Please sign in or contact an officer.');
    END IF;
  END IF;

  -- 3. Verify auth user is not already linked to a different student
  IF EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND student_id IS NOT NULL AND student_id <> v_student.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account is already linked to another student record.');
  END IF;

  -- 4. Check for active unrevoked activation claim
  SELECT * INTO v_claim 
  FROM activation_claims 
  WHERE student_id = v_student.id 
    AND used_at IS NULL 
    AND revoked_at IS NULL
  ORDER BY created_at DESC 
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active activation code found for this student. Please request one from an officer.');
  END IF;

  -- 5. Rate limiting / attempt limit check
  IF v_claim.attempt_count >= v_claim.max_attempts THEN
    UPDATE activation_claims SET revoked_at = now() WHERE id = v_claim.id;
    INSERT INTO activation_claims_audit (claim_id, student_id, action, notes)
    VALUES (v_claim.id, v_student.id, 'REVOKED', 'Exceeded maximum failed activation attempts');
    RETURN jsonb_build_object('success', false, 'error', 'Too many failed activation attempts. Code revoked. Please request a new one from an officer.');
  END IF;

  -- 6. Check expiration
  IF v_claim.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This activation code has expired. Please request a new one from an officer.');
  END IF;

  -- 7. Validate hash
  IF v_claim.token_hash <> p_token_hash THEN
    UPDATE activation_claims 
    SET attempt_count = attempt_count + 1, 
        last_attempt_at = now() 
    WHERE id = v_claim.id;

    INSERT INTO activation_claims_audit (claim_id, student_id, action, notes)
    VALUES (v_claim.id, v_student.id, 'ATTEMPT_FAILED', format('Incorrect token hash attempt %s of %s', v_claim.attempt_count + 1, v_claim.max_attempts));

    IF v_claim.attempt_count + 1 >= v_claim.max_attempts THEN
      UPDATE activation_claims SET revoked_at = now() WHERE id = v_claim.id;
    END IF;

    -- Generic message
    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code or school ID.');
  END IF;

  -- 8. ATOMIC SUCCESS TRANSACTION: consume claim, link user, assign STUDENT role
  UPDATE activation_claims 
  SET used_at = now(), 
      claimed_by_user_id = v_user_id 
  WHERE id = v_claim.id;

  INSERT INTO users (id, username, student_id, account_status, created_at, updated_at)
  VALUES (v_user_id, lower(v_student.school_id), v_student.id, 'ACTIVE', now(), now())
  ON CONFLICT (id) DO UPDATE SET
    student_id = EXCLUDED.student_id,
    username = EXCLUDED.username,
    account_status = 'ACTIVE',
    updated_at = now();

  INSERT INTO user_roles (id, user_id, role, assigned_at)
  VALUES (gen_random_uuid(), v_user_id, 'STUDENT', now())
  ON CONFLICT DO NOTHING;

  INSERT INTO activation_claims_audit (claim_id, student_id, action, performed_by_user_id, notes)
  VALUES (v_claim.id, v_student.id, 'CLAIMED', v_user_id, 'Student self-registration completed');

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student.id,
    'school_id', v_student.school_id,
    'first_name', v_student.first_name,
    'last_name', v_student.last_name
  );
END;
$$;

-- 5. Authorized Officer Issue/Reissue Activation Code RPC Function
CREATE OR REPLACE FUNCTION officer_issue_activation_code(
  p_student_id UUID,
  p_token_hash TEXT,
  p_expires_hours INT DEFAULT 48
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_role RECORD;
  v_student RECORD;
  v_new_claim_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_action TEXT := 'ISSUED';
BEGIN
  -- Verify caller is OFFICER or DEVADMIN
  SELECT role INTO v_caller_role 
  FROM user_roles 
  WHERE user_id = auth.uid() 
    AND role IN ('DEVADMIN', 'OFFICER') 
    AND revoked_at IS NULL 
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized. Only officers can issue activation codes.');
  END IF;

  SELECT * INTO v_student FROM students WHERE id = p_student_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student not found.');
  END IF;

  -- Revoke any existing pending claims
  IF EXISTS (SELECT 1 FROM activation_claims WHERE student_id = p_student_id AND used_at IS NULL AND revoked_at IS NULL) THEN
    UPDATE activation_claims 
    SET revoked_at = now() 
    WHERE student_id = p_student_id AND used_at IS NULL AND revoked_at IS NULL;
    v_action := 'REISSUED';
  END IF;

  v_expires_at := now() + (p_expires_hours || ' hours')::INTERVAL;
  v_new_claim_id := gen_random_uuid();

  INSERT INTO activation_claims (
    id, student_id, token_hash, issued_by_user_id, expires_at, created_at, attempt_count, max_attempts
  ) VALUES (
    v_new_claim_id, p_student_id, p_token_hash, auth.uid(), v_expires_at, now(), 0, 5
  );

  INSERT INTO activation_claims_audit (
    claim_id, student_id, action, performed_by_user_id, notes
  ) VALUES (
    v_new_claim_id, p_student_id, v_action, auth.uid(), format('Code %s with expiration in %s hours', lower(v_action), p_expires_hours)
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_new_claim_id,
    'expires_at', v_expires_at,
    'action', v_action
  );
END;
$$;

-- 6. Authorized Officer Revoke Activation Code RPC Function
CREATE OR REPLACE FUNCTION officer_revoke_activation_code(
  p_claim_id UUID,
  p_reason TEXT DEFAULT 'Officer manual revocation'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
BEGIN
  -- Verify caller is OFFICER or DEVADMIN
  IF NOT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
      AND role IN ('DEVADMIN', 'OFFICER') 
      AND revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized.');
  END IF;

  SELECT * INTO v_claim FROM activation_claims WHERE id = p_claim_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Activation claim not found.');
  END IF;

  UPDATE activation_claims SET revoked_at = now() WHERE id = p_claim_id;

  INSERT INTO activation_claims_audit (
    claim_id, student_id, action, performed_by_user_id, notes
  ) VALUES (
    p_claim_id, v_claim.student_id, 'REVOKED', auth.uid(), p_reason
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7. Get Student Activation Status RPC Function
CREATE OR REPLACE FUNCTION officer_get_student_activation_status(
  p_student_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_claim RECORD;
  v_status TEXT := 'NOT_ACTIVATED';
  v_audit JSONB;
BEGIN
  -- Check if already activated
  SELECT * INTO v_user FROM users WHERE student_id = p_student_id;
  IF FOUND AND v_user.account_status = 'ACTIVE' THEN
    v_status := 'ACTIVATED';
  ELSE
    -- Check latest claim
    SELECT * INTO v_claim 
    FROM activation_claims 
    WHERE student_id = p_student_id 
    ORDER BY created_at DESC 
    LIMIT 1;

    IF FOUND THEN
      IF v_claim.revoked_at IS NOT NULL OR v_claim.attempt_count >= v_claim.max_attempts THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSIF v_claim.used_at IS NOT NULL THEN
        v_status := 'ACTIVATED';
      ELSIF v_claim.expires_at < now() THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSE
        v_status := 'ACTIVATION_PENDING';
      END IF;
    ELSE
      v_status := 'NOT_ACTIVATED';
    END IF;
  END IF;

  -- Load audit trail
  SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT action, performed_by_user_id, notes, created_at 
    FROM activation_claims_audit 
    WHERE student_id = p_student_id 
    ORDER BY created_at DESC 
    LIMIT 10
  ) a;

  RETURN jsonb_build_object(
    'status', v_status,
    'student_id', p_student_id,
    'claim_id', v_claim.id,
    'expires_at', v_claim.expires_at,
    'attempt_count', v_claim.attempt_count,
    'max_attempts', v_claim.max_attempts,
    'linked_user_id', v_user.id,
    'linked_username', v_user.username,
    'audit_history', v_audit
  );
END;
$$;

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- A. Students table
ALTER TABLE students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage all students" ON students;
CREATE POLICY "Officers manage all students" ON students
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );

DROP POLICY IF EXISTS "Students view own profile only" ON students;
CREATE POLICY "Students view own profile only" ON students
  FOR SELECT USING (
    id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

-- B. Student Enrollments
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage student enrollments" ON student_enrollments;
CREATE POLICY "Officers manage student enrollments" ON student_enrollments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );

DROP POLICY IF EXISTS "Students view own enrollments only" ON student_enrollments;
CREATE POLICY "Students view own enrollments only" ON student_enrollments
  FOR SELECT USING (
    student_id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

-- C. Activation Claims & Audit
ALTER TABLE activation_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage activation claims" ON activation_claims;
CREATE POLICY "Officers manage activation claims" ON activation_claims
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );

ALTER TABLE activation_claims_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers view activation audit" ON activation_claims_audit;
CREATE POLICY "Officers view activation audit" ON activation_claims_audit
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );

-- D. Obligations & Payments
ALTER TABLE student_obligations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage student obligations" ON student_obligations;
CREATE POLICY "Officers manage student obligations" ON student_obligations
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );

DROP POLICY IF EXISTS "Students view own obligations" ON student_obligations;
CREATE POLICY "Students view own obligations" ON student_obligations
  FOR SELECT USING (
    student_id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage payments" ON payments;
CREATE POLICY "Officers manage payments" ON payments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );

DROP POLICY IF EXISTS "Students view own payments" ON payments;
CREATE POLICY "Students view own payments" ON payments
  FOR SELECT USING (
    student_id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

-- E. Public/Anon Non-Consuming Activation Code Pre-Check Function
CREATE OR REPLACE FUNCTION validate_activation_code(
  p_school_id TEXT,
  p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_student RECORD;
  v_claim RECORD;
  v_clean_school_id TEXT;
BEGIN
  v_clean_school_id := trim(p_school_id);

  -- 1. Find active student
  SELECT * INTO v_student 
  FROM students 
  WHERE lower(school_id) = lower(v_clean_school_id) 
    AND status = 'ACTIVE';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student record not found for this School ID.');
  END IF;

  -- 2. Check if already activated
  IF EXISTS (SELECT 1 FROM users WHERE student_id = v_student.id AND account_status = 'ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This student record has already been activated. Please sign in.');
  END IF;

  -- 3. Match claim
  SELECT * INTO v_claim 
  FROM activation_claims 
  WHERE student_id = v_student.id 
    AND used_at IS NULL 
    AND revoked_at IS NULL
    AND token_hash = p_token_hash
  ORDER BY created_at DESC 
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code or not found for this student.');
  END IF;

  IF v_claim.attempt_count >= v_claim.max_attempts THEN
    RETURN jsonb_build_object('success', false, 'error', 'Activation code revoked due to excessive failed attempts.');
  END IF;

  IF v_claim.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This activation code has expired.');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student.id,
    'student_name', trim(v_student.first_name || ' ' || v_student.last_name)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_activation_code(TEXT, TEXT) TO anon, authenticated;


