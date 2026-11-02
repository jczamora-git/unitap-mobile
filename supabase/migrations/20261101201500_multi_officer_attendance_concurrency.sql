-- ==============================================================================
-- UniTap 2.0: Multi-Officer Attendance Concurrency, Security, Audit & Sync Engine
-- Migration: 20261101201500_multi_officer_attendance_concurrency.sql
-- Description:
--   Consolidated & hardened migration addressing all multi-officer concurrency,
--   cross-device sync, deterministic cursor pagination, and fail-closed security:
--   1. Schema Alignment & Constraints (version, audit_flags, scope_id TEXT)
--   2. Strict Immutability of attendance_audit (Trigger + Privilege Revocation)
--   3. True Transactional Idempotency Ledger (attendance_operation_receipts)
--   4. Scoped Sync Conflict Ledger (sync_conflicts with discrete per-operation RLS)
--   5. Atomic Attendance Scan RPC (record_attendance_scan) with:
--      - Fail-closed caller role validation (NULL role rejected)
--      - Safe unassigned appointment handling
--      - Participant roster & audience eligibility validation
--      - Active NFC card binding & UID verification
--      - Session window grace policy for late offline uploads
--      - Future / stale client timestamp guards
--      - Concurrency race serialization & duplicate scan attempt logging
--      - Idempotency replay for COMPLETED, FAILED, and in-flight PROCESSING
--   6. Atomic Attendance Revocation RPC (revoke_attendance) with mandatory version
--   7. Atomic Attendance Recheck RPC (recheck_attendance) with mandatory version
--   8. Strict Allowlist in sync_push_batch (All app entity types handled, no dynamic SQL)
--   9. Deterministic Cursor Pagination (updated_at, id) & Scoped sync_pull_batch
--      (Returns nfc_cards, enrollments, participants, allocations, audit trail;
--       EVENT-scoped officers strictly restricted from receiving all students)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA ALIGNMENT & STRUCTURAL HARDENING
-- ------------------------------------------------------------------------------

-- Ensure required columns exist on attendance_records
ALTER TABLE IF EXISTS public.attendance_records 
  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS revocation_reason TEXT,
  ADD COLUMN IF NOT EXISTS client_scanned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rechecked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rechecked_by_user_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS recheck_reason TEXT,
  ADD COLUMN IF NOT EXISTS audit_flags TEXT;

-- Ensure attendance_records has unique index / constraint on (occurrence_id, student_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.attendance_records'::regclass
      AND contype = 'u'
      AND array_to_string(conkey, ',') = (
        SELECT array_to_string(array_agg(attnum ORDER BY attnum), ',')
        FROM pg_attribute
        WHERE attrelid = 'public.attendance_records'::regclass
          AND attname IN ('occurrence_id', 'student_id')
      )
  ) THEN
    ALTER TABLE public.attendance_records
      ADD CONSTRAINT attendance_records_occurrence_id_student_id_key UNIQUE (occurrence_id, student_id);
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- Ensure officer_appointments table exists with TEXT scope_id
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.officer_appointments (
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
  scope_id TEXT,
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

CREATE INDEX IF NOT EXISTS idx_officer_appts_user ON public.officer_appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_officer_appts_student ON public.officer_appointments(student_id);
CREATE INDEX IF NOT EXISTS idx_officer_appts_status ON public.officer_appointments(status);
CREATE INDEX IF NOT EXISTS idx_officer_appts_term ON public.officer_appointments(semester_id);

ALTER TABLE public.officer_appointments ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.officer_appointments 
  ALTER COLUMN scope_id TYPE TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'officer_appointments' AND policyname = 'DevAdmin full access on officer_appointments'
  ) THEN
    CREATE POLICY "DevAdmin full access on officer_appointments"
      ON public.officer_appointments
      FOR ALL
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_id = auth.uid()
            AND role = 'DEVADMIN'
            AND revoked_at IS NULL
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_id = auth.uid()
            AND role = 'DEVADMIN'
            AND revoked_at IS NULL
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'officer_appointments' AND policyname = 'Officers view own appointment'
  ) THEN
    CREATE POLICY "Officers view own appointment"
      ON public.officer_appointments
      FOR SELECT
      TO authenticated
      USING (user_id = auth.uid() AND status IN ('ACTIVE', 'SUSPENDED'));
  END IF;
END $$;

-- Audit table column extensions
ALTER TABLE IF EXISTS public.attendance_audit 
  ADD COLUMN IF NOT EXISTS occurrence_id UUID,
  ADD COLUMN IF NOT EXISTS student_id UUID,
  ADD COLUMN IF NOT EXISTS old_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS new_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Ensure cursor pagination timestamp columns exist across all synced tables
ALTER TABLE IF EXISTS public.nfc_cards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.event_participants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.obligation_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE IF EXISTS public.payment_allocations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- High performance lookup and cursor pagination indexes
CREATE INDEX IF NOT EXISTS idx_attendance_records_occ_status 
  ON public.attendance_records (occurrence_id, status);

CREATE INDEX IF NOT EXISTS idx_attendance_records_cursor 
  ON public.attendance_records (updated_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_att_id 
  ON public.attendance_audit (attendance_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_audit_cursor 
  ON public.attendance_audit (performed_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_attendance_attempts_lookup 
  ON public.attendance_attempts (occurrence_id, student_id, attempted_at DESC);

-- ------------------------------------------------------------------------------
-- 2. STRICT IMMUTABILITY TRIGGER FOR ATTENDANCE AUDIT
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_attendance_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RAISE EXCEPTION 'attendance_audit records are strictly immutable. UPDATE and DELETE operations are forbidden.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_attendance_audit_mutation ON public.attendance_audit;
CREATE TRIGGER trg_prevent_attendance_audit_mutation
BEFORE UPDATE OR DELETE ON public.attendance_audit
FOR EACH ROW
EXECUTE FUNCTION public.prevent_attendance_audit_mutation();

-- Revoke mutation privileges on audit table
REVOKE UPDATE, DELETE ON public.attendance_audit FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 3. TRUE TRANSACTIONAL IDEMPOTENCY LEDGER
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.attendance_operation_receipts (
  idempotency_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  operation_type VARCHAR(30) NOT NULL, -- 'SCAN', 'REVOKE', 'RECHECK'
  occurrence_id UUID REFERENCES event_occurrences(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  attendance_id UUID,
  request_fingerprint TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_att_receipts_lookup 
  ON public.attendance_operation_receipts(occurrence_id, student_id);

CREATE INDEX IF NOT EXISTS idx_att_receipts_user 
  ON public.attendance_operation_receipts(user_id);

ALTER TABLE public.attendance_operation_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers can view own receipts, DevAdmin views all" ON public.attendance_operation_receipts;
DROP POLICY IF EXISTS "DevAdmin and Officers can view attendance operation receipts" ON public.attendance_operation_receipts;

CREATE POLICY "Officers can view own receipts, DevAdmin views all"
ON public.attendance_operation_receipts
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.revoked_at IS NULL
      AND ur.role = 'DEVADMIN'
  )
);

-- ------------------------------------------------------------------------------
-- 4. SCOPED SYNC CONFLICTS LEDGER
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  conflict_type VARCHAR(50) NOT NULL,
  client_payload JSONB NOT NULL,
  server_payload JSONB,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Ensure existing sync_conflicts table has the status column and allows text device_id
ALTER TABLE IF EXISTS public.sync_conflicts DROP CONSTRAINT IF EXISTS sync_conflicts_device_id_fkey;
ALTER TABLE IF EXISTS public.sync_conflicts ALTER COLUMN device_id TYPE TEXT;
ALTER TABLE IF EXISTS public.sync_conflicts ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'OPEN';

ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers and DevAdmin view sync conflicts" ON public.sync_conflicts;
DROP POLICY IF EXISTS "DevAdmin full access to sync conflicts" ON public.sync_conflicts;
DROP POLICY IF EXISTS "Officers select sync conflicts" ON public.sync_conflicts;
DROP POLICY IF EXISTS "Officers insert sync conflicts" ON public.sync_conflicts;
DROP POLICY IF EXISTS "Officers update sync conflicts" ON public.sync_conflicts;

-- DevAdmin: full administrative control
CREATE POLICY "DevAdmin full access to sync conflicts"
ON public.sync_conflicts
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.revoked_at IS NULL
      AND ur.role = 'DEVADMIN'
  )
);

-- Officers: discrete SELECT policy scoped to active appointment
CREATE POLICY "Officers select sync conflicts"
ON public.sync_conflicts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN officer_appointments oa ON oa.user_id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND ur.revoked_at IS NULL
      AND ur.role = 'OFFICER'
      AND oa.status = 'ACTIVE'
      AND oa.revoked_at IS NULL
      AND oa.appointment_start <= now()
      AND oa.appointment_end >= now()
  )
);

-- Officers: discrete INSERT policy for reporting device conflicts
CREATE POLICY "Officers insert sync conflicts"
ON public.sync_conflicts
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN officer_appointments oa ON oa.user_id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND ur.revoked_at IS NULL
      AND ur.role = 'OFFICER'
      AND oa.status = 'ACTIVE'
      AND oa.revoked_at IS NULL
      AND oa.appointment_start <= now()
      AND oa.appointment_end >= now()
  )
);

-- Officers: discrete UPDATE policy to update status of resolved conflicts
CREATE POLICY "Officers update sync conflicts"
ON public.sync_conflicts
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN officer_appointments oa ON oa.user_id = ur.user_id
    WHERE ur.user_id = auth.uid()
      AND ur.revoked_at IS NULL
      AND ur.role = 'OFFICER'
      AND oa.status = 'ACTIVE'
      AND oa.revoked_at IS NULL
      AND oa.appointment_start <= now()
      AND oa.appointment_end >= now()
  )
)
WITH CHECK (
  status IN ('OPEN', 'RESOLVED', 'IGNORED')
);

-- ------------------------------------------------------------------------------
-- 5. ATOMIC ATTENDANCE SCAN RPC: record_attendance_scan
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.record_attendance_scan(
  p_occurrence_id UUID,
  p_student_id UUID,
  p_nfc_card_id UUID DEFAULT NULL,
  p_uid_normalized VARCHAR(64) DEFAULT NULL,
  p_status_override VARCHAR(20) DEFAULT NULL,
  p_device_id TEXT DEFAULT 'dev_default',
  p_idempotency_key TEXT DEFAULT NULL,
  p_client_scanned_at TIMESTAMPTZ DEFAULT NULL,
  p_scan_method VARCHAR(20) DEFAULT 'NFC',
  p_photo_checked INT DEFAULT 0,
  p_manual_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_rec RECORD;
  v_role TEXT;
  v_officer_appt RECORD;
  v_occurrence RECORD;
  v_student RECORD;
  v_nfc_card RECORD;
  v_existing RECORD;
  v_receipt_rec RECORD;
  v_fingerprint TEXT;
  v_suggested_status VARCHAR(20) := 'PRESENT';
  v_record_id UUID;
  v_audit_id UUID;
  v_now TIMESTAMPTZ := now();
  v_scan_time TIMESTAMPTZ;
  v_occ_start TIMESTAMPTZ;
  v_occ_end TIMESTAMPTZ;
  v_late_threshold TIMESTAMPTZ;
  v_revoker_name TEXT;
  v_result JSONB;
  v_constraint_name TEXT;
  v_audit_flags TEXT := NULL;
  v_has_active_window BOOLEAN := false;
BEGIN
  -- 1. Authenticate caller (Fail-closed)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Authentication required to confirm attendance.'
    );
  END IF;

  -- 2. Validate user account status
  SELECT * INTO v_user_rec
  FROM users
  WHERE id = v_user_id;

  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Caller account is suspended, inactive, or not found.'
    );
  END IF;

  -- 3. Fail-closed role authorization check (NULL role rejected)
  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Officer or DevAdmin permissions required to scan attendance.'
    );
  END IF;

  -- 4. Validate Occurrence State
  SELECT eo.*, ev.semester_id, ev.title as event_title, ev.event_type, ev.id as parent_event_id,
         ev.audience_type, ev.audience_json
  INTO v_occurrence
  FROM event_occurrences eo
  JOIN events ev ON ev.id = eo.event_id
  WHERE eo.id = p_occurrence_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'NOT_FOUND',
      'message', 'Event occurrence not found.'
    );
  END IF;

  -- 5. Officer Scope & Appointment Validation (Never touch v_officer_appt for DEVADMIN)
  IF v_role = 'OFFICER' THEN
    SELECT * INTO v_officer_appt
    FROM officer_appointments
    WHERE user_id = v_user_id
      AND status = 'ACTIVE'
      AND suspended_at IS NULL
      AND revoked_at IS NULL
      AND appointment_start <= v_now
      AND appointment_end >= v_now
      AND (
        permission_preset IN ('ATTENDANCE', 'FULL')
        OR custom_permissions ? 'ATTENDANCE'
        OR custom_permissions ? 'attendance'
      )
    ORDER BY appointment_end DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'status', 'UNAUTHORIZED',
        'message', 'Active, unexpired officer appointment with attendance permissions is required.'
      );
    END IF;

    -- Scope check
    IF v_officer_appt.scope_type = 'EVENT' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF v_officer_appt.scope_id <> v_occurrence.parent_event_id::text THEN
        RETURN jsonb_build_object(
          'status', 'FORBIDDEN_SCOPE',
          'message', 'Officer appointment scope does not authorize attendance for this event.'
        );
      END IF;
    ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM student_enrollments se 
        WHERE se.student_id = p_student_id 
          AND se.program_id = v_officer_appt.scope_id
          AND se.semester_id = v_occurrence.semester_id::text
      ) THEN
        RETURN jsonb_build_object(
          'status', 'FORBIDDEN_SCOPE',
          'message', 'Student does not belong to authorized officer program scope for this semester.'
        );
      END IF;
    ELSIF v_officer_appt.scope_type = 'SECTION' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM student_enrollments se 
        WHERE se.student_id = p_student_id 
          AND se.section_id::text = v_officer_appt.scope_id
          AND se.semester_id = v_occurrence.semester_id::text
      ) THEN
        RETURN jsonb_build_object(
          'status', 'FORBIDDEN_SCOPE',
          'message', 'Student does not belong to authorized officer section scope for this semester.'
        );
      END IF;
    END IF;
  END IF;

  -- 6. True Transactional Idempotency Reservation
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    v_fingerprint := md5(
      p_occurrence_id::text || ':' ||
      p_student_id::text || ':' ||
      coalesce(p_nfc_card_id::text, '') || ':' ||
      coalesce(lower(p_uid_normalized), '') || ':' ||
      coalesce(p_scan_method, 'NFC') || ':' ||
      coalesce(to_char(p_client_scanned_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
    );

    SELECT * INTO v_receipt_rec
    FROM attendance_operation_receipts
    WHERE idempotency_key = trim(p_idempotency_key)
    FOR UPDATE;

    IF FOUND THEN
      IF v_receipt_rec.user_id <> v_user_id THEN
        RETURN jsonb_build_object(
          'status', 'IDEMPOTENCY_REUSE_FORBIDDEN',
          'message', 'Idempotency key has already been used by another user.'
        );
      END IF;

      IF v_receipt_rec.request_fingerprint <> v_fingerprint THEN
        RETURN jsonb_build_object(
          'status', 'IDEMPOTENCY_PAYLOAD_MISMATCH',
          'message', 'Idempotency key was reused with different request payload.'
        );
      END IF;

      -- Replay COMPLETED or FAILED results deterministically
      IF v_receipt_rec.status IN ('COMPLETED', 'FAILED') THEN
        RETURN v_receipt_rec.response_payload || jsonb_build_object('is_replay', true);
      END IF;
      -- If status is PROCESSING, current lock holder continues or retries
    ELSE
      -- Insert atomic reservation
      INSERT INTO attendance_operation_receipts (
        idempotency_key, user_id, operation_type, occurrence_id, student_id,
        request_fingerprint, status, created_at
      ) VALUES (
        trim(p_idempotency_key), v_user_id, 'SCAN', p_occurrence_id, p_student_id,
        v_fingerprint, 'PROCESSING', v_now
      );
    END IF;
  END IF;

  -- 7. Validate Student Active Status
  SELECT * INTO v_student
  FROM students
  WHERE id = p_student_id AND status = 'ACTIVE';

  IF NOT FOUND THEN
    v_result := jsonb_build_object(
      'status', 'NOT_ELIGIBLE',
      'message', 'Student record not found or inactive.'
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 8. NFC Card Binding & UID Consistency Validation
  IF p_scan_method = 'NFC' THEN
    IF (p_uid_normalized IS NULL OR trim(p_uid_normalized) = '') AND p_nfc_card_id IS NULL THEN
      v_result := jsonb_build_object(
        'status', 'NFC_REQUIRED',
        'message', 'NFC card UID or card reference is required for physical NFC scans.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;

    -- If both are supplied, verify card consistency
    IF p_nfc_card_id IS NOT NULL AND (p_uid_normalized IS NOT NULL AND trim(p_uid_normalized) <> '') THEN
      SELECT * INTO v_nfc_card
      FROM nfc_cards
      WHERE id = p_nfc_card_id 
        AND lower(uid_normalized) = lower(trim(p_uid_normalized))
        AND status = 'ACTIVE';

      IF NOT FOUND THEN
        v_result := jsonb_build_object(
          'status', 'NFC_IDENTITY_INCONSISTENT',
          'message', 'Supplied NFC card ID and card UID do not match the same active card.'
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    ELSE
      SELECT * INTO v_nfc_card
      FROM nfc_cards
      WHERE status = 'ACTIVE'
        AND (
          (p_uid_normalized IS NOT NULL AND lower(uid_normalized) = lower(trim(p_uid_normalized)))
          OR (p_nfc_card_id IS NOT NULL AND id = p_nfc_card_id)
        )
      ORDER BY assigned_at DESC
      LIMIT 1;

      IF NOT FOUND THEN
        v_result := jsonb_build_object(
          'status', 'INVALID_CARD',
          'message', 'NFC card is not registered or active in the system.'
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    END IF;

    -- Card must belong to the scanned student
    IF v_nfc_card.student_id <> p_student_id THEN
      v_result := jsonb_build_object(
        'status', 'CARD_STUDENT_MISMATCH',
        'message', 'Scanned NFC card is registered to a different student.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;

  ELSIF p_scan_method = 'MANUAL' THEN
    IF p_manual_reason IS NULL OR trim(p_manual_reason) = '' THEN
      v_result := jsonb_build_object(
        'status', 'MANUAL_REASON_REQUIRED',
        'message', 'A reason is mandatory for manual officer attendance entry.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;
  ELSE
    v_result := jsonb_build_object(
      'status', 'INVALID_METHOD',
      'message', format('Unsupported scan method: %s.', p_scan_method)
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 9. Participant Roster & Audience Eligibility
  IF EXISTS (SELECT 1 FROM event_participants WHERE occurrence_id = p_occurrence_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM event_participants 
      WHERE occurrence_id = p_occurrence_id AND student_id = p_student_id
    ) THEN
      v_result := jsonb_build_object(
        'status', 'NOT_ELIGIBLE',
        'message', 'Student is not on the participant roster for this occurrence.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;
  ELSE
    -- If no explicit roster, check audience_type configuration
    IF v_occurrence.audience_type = 'PROGRAM' AND v_occurrence.audience_json IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM student_enrollments se
        WHERE se.student_id = p_student_id
          AND se.semester_id = v_occurrence.semester_id::text
          AND (v_occurrence.audience_json->'program_ids') ? se.program_id
      ) THEN
        v_result := jsonb_build_object(
          'status', 'NOT_ELIGIBLE',
          'message', 'Student program is not eligible for this event.'
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    ELSIF v_occurrence.audience_type = 'CUSTOM' THEN
      v_result := jsonb_build_object(
        'status', 'NOT_ELIGIBLE',
        'message', 'Custom event requires student to be explicitly added to participant roster.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;
  END IF;

  -- 10. ATOMIC ROW-LEVEL CONCURRENCY CHECK
  SELECT * INTO v_existing
  FROM attendance_records
  WHERE occurrence_id = p_occurrence_id AND student_id = p_student_id
  FOR UPDATE;

  IF FOUND THEN
    -- If previously revoked: DO NOT silently un-revoke. Require explicit recheck!
    IF v_existing.status = 'REVOKED' THEN
      SELECT coalesce(username, 'Authorized Officer') INTO v_revoker_name
      FROM users WHERE id = v_existing.revoked_by_user_id;

      -- Log attempt in attendance_attempts
      INSERT INTO attendance_attempts (
        id, occurrence_id, card_uid, student_id, actor_user_id,
        result, reason, attempted_at
      ) VALUES (
        gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
        'REVOKED_REVIEW_REQUIRED', coalesce(v_existing.revocation_reason, 'Revoked record re-scan blocked'), v_now
      );

      v_result := jsonb_build_object(
        'status', 'REVOKED_REVIEW_REQUIRED',
        'message', format('Attendance was revoked by %s. Reason: "%s". Explicit recheck authorization required.', coalesce(v_revoker_name, 'Officer'), coalesce(v_existing.revocation_reason, 'No reason specified')),
        'attendance_record', to_jsonb(v_existing),
        'revoked_at', v_existing.revoked_at,
        'revocation_reason', v_existing.revocation_reason
      );

      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts
        SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;

      RETURN v_result;
    END IF;

    -- If already confirmed present or late:
    IF v_existing.status IN ('PRESENT', 'LATE') THEN
      -- Log duplicate attempt
      INSERT INTO attendance_attempts (
        id, occurrence_id, card_uid, student_id, actor_user_id,
        result, reason, attempted_at
      ) VALUES (
        gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
        'ALREADY_RECORDED', format('Duplicate scan attempt. Already recorded as %s', v_existing.status), v_now
      );

      v_result := jsonb_build_object(
        'status', 'ALREADY_RECORDED',
        'message', format('%s %s is already recorded as %s at %s.', v_student.first_name, v_student.last_name, v_existing.status, to_char(v_existing.checked_in_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')),
        'attendance_record', to_jsonb(v_existing)
      );

      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts
        SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;

      RETURN v_result;
    END IF;
  END IF;

  -- 11. Authoritative Offline Timestamp & Late Sync Grace Policy
  v_scan_time := coalesce(p_client_scanned_at, v_now);

  -- Guard against clock manipulation
  IF v_scan_time > v_now + interval '5 minutes' THEN
    -- Future timestamp clamped
    v_scan_time := v_now;
    v_audit_flags := 'FUTURE_TIMESTAMP_CLAMPED';
  ELSIF v_scan_time < v_now - interval '7 days' THEN
    -- Flag stale offline upload
    v_audit_flags := 'STALE_TIMESTAMP_FLAGGED';
  END IF;

  -- Verify session window
  IF v_occurrence.occurs_on IS NOT NULL AND v_occurrence.starts_at IS NOT NULL AND v_occurrence.ends_at IS NOT NULL THEN
    v_occ_start := (v_occurrence.occurs_on::text || ' ' || v_occurrence.starts_at::text)::timestamp AT TIME ZONE 'Asia/Manila';
    v_occ_end := (v_occurrence.occurs_on::text || ' ' || v_occurrence.ends_at::text)::timestamp AT TIME ZONE 'Asia/Manila';
    v_late_threshold := v_occ_start + (coalesce(v_occurrence.grace_minutes, 15) || ' minutes')::interval;

    IF v_scan_time >= (v_occ_start - interval '1 hour') AND v_scan_time <= (v_occ_end + interval '30 minutes') THEN
      v_has_active_window := true;
    END IF;

    -- Late offline sync grace check
    IF v_occurrence.status <> 'OPEN' THEN
      IF p_client_scanned_at IS NOT NULL AND v_has_active_window THEN
        -- Accepted under late offline sync grace policy
        v_audit_flags := coalesce(v_audit_flags || ', ', '') || 'OFFLINE_LATE_SYNC_ACCEPTED';
      ELSE
        v_result := jsonb_build_object(
          'status', 'OCCURRENCE_CLOSED',
          'message', format('Event session is %s and scan time is outside the valid session window.', v_occurrence.status)
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    ELSE
      -- Occurrence is OPEN; ensure scan is within end time window
      IF v_scan_time > v_occ_end + interval '30 minutes' THEN
        v_result := jsonb_build_object(
          'status', 'OCCURRENCE_CLOSED',
          'message', format('Scan occurred after occurrence ended at %s.', to_char(v_occ_end, 'HH12:MI AM'))
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    END IF;

    -- Deterministic PRESENT vs LATE evaluation based on physical scan_time
    IF v_scan_time > v_late_threshold THEN
      v_suggested_status := 'LATE';
    ELSE
      v_suggested_status := 'PRESENT';
    END IF;

    IF v_now > v_scan_time + interval '1 hour' THEN
      v_audit_flags := coalesce(v_audit_flags || ', ', '') || 'DELAYED_OFFLINE_UPLOAD';
    END IF;
  ELSE
    -- If occurrence lacks explicit schedule times, require OPEN status
    IF v_occurrence.status <> 'OPEN' THEN
      v_result := jsonb_build_object(
        'status', 'OCCURRENCE_CLOSED',
        'message', format('Event session is %s and not accepting attendance.', v_occurrence.status)
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;
  END IF;

  -- DevAdmin explicit override takes precedence
  IF v_role = 'DEVADMIN' AND p_status_override IS NOT NULL AND p_status_override IN ('PRESENT', 'LATE') THEN
    v_suggested_status := p_status_override;
  END IF;

  -- 12. ATOMIC RECORD CREATION OR UPDATE
  IF v_existing.id IS NOT NULL THEN
    UPDATE attendance_records
    SET status = v_suggested_status,
        checked_in_at = v_scan_time,
        client_scanned_at = coalesce(p_client_scanned_at, v_now),
        method = p_scan_method,
        photo_checked = coalesce(p_photo_checked, 0),
        identity_verified_by_user_id = v_user_id,
        audit_flags = v_audit_flags,
        version = version + 1,
        updated_at = v_now
    WHERE id = v_existing.id;

    v_record_id := v_existing.id;
  ELSE
    v_record_id := gen_random_uuid();
    INSERT INTO attendance_records (
      id, occurrence_id, student_id, status, checked_in_at, client_scanned_at,
      method, photo_checked, identity_verified_by_user_id, audit_flags,
      version, updated_at
    ) VALUES (
      v_record_id, p_occurrence_id, p_student_id, v_suggested_status, v_scan_time, coalesce(p_client_scanned_at, v_now),
      p_scan_method, coalesce(p_photo_checked, 0), v_user_id, v_audit_flags,
      1, v_now
    );
  END IF;

  -- 13. Append Immutable Audit Trail Entry
  v_audit_id := gen_random_uuid();
  INSERT INTO attendance_audit (
    id, attendance_id, occurrence_id, student_id, action,
    old_status, new_status, reason, performed_by_user_id, performed_at
  ) VALUES (
    v_audit_id, v_record_id, p_occurrence_id, p_student_id, 'CHECK_IN',
    coalesce(v_existing.status, 'NOT_RECORDED'), v_suggested_status,
    CASE 
      WHEN p_scan_method = 'MANUAL' THEN coalesce(p_manual_reason, 'Manual officer confirmation')
      ELSE format('Officer scan via %s (%s)', p_scan_method, coalesce(v_audit_flags, 'NORMAL'))
    END,
    v_user_id, v_now
  );

  -- 14. Log Successful Scan Attempt
  INSERT INTO attendance_attempts (
    id, occurrence_id, card_uid, student_id, actor_user_id,
    result, reason, attempted_at
  ) VALUES (
    gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
    'CONFIRMED', v_suggested_status, v_now
  );

  -- Build success response
  v_result := jsonb_build_object(
    'status', 'RECORDED',
    'message', format('%s %s successfully confirmed as %s!', v_student.first_name, v_student.last_name, v_suggested_status),
    'attendance_record', jsonb_build_object(
      'id', v_record_id,
      'occurrence_id', p_occurrence_id,
      'student_id', p_student_id,
      'status', v_suggested_status,
      'checked_in_at', v_scan_time,
      'client_scanned_at', coalesce(p_client_scanned_at, v_now),
      'identity_verified_by_user_id', v_user_id,
      'photo_checked', coalesce(p_photo_checked, 0),
      'version', coalesce(v_existing.version, 0) + 1,
      'audit_flags', v_audit_flags
    )
  );

  -- 15. Complete Idempotency Reservation
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    UPDATE attendance_operation_receipts
    SET status = 'COMPLETED',
        response_payload = v_result,
        attendance_id = v_record_id,
        completed_at = now()
    WHERE idempotency_key = trim(p_idempotency_key);
  END IF;

  RETURN v_result;

EXCEPTION WHEN unique_violation THEN
  GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
  
  IF v_constraint_name LIKE '%occurrence%' 
     OR v_constraint_name LIKE '%attendance_records%' 
     OR SQLERRM LIKE '%occurrence_id, student_id%'
     OR SQLERRM LIKE '%attendance_records%' THEN
    -- Simultaneous race: Another officer committed milliseconds before us
    SELECT * INTO v_existing
    FROM attendance_records
    WHERE occurrence_id = p_occurrence_id AND student_id = p_student_id;

    -- Log collision attempt in attendance_attempts
    INSERT INTO attendance_attempts (
      id, occurrence_id, card_uid, student_id, actor_user_id,
      result, reason, attempted_at
    ) VALUES (
      gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
      'COLLISION_CONCURRENCY', 'Simultaneous race scan attempt caught by unique constraint', v_now
    );

    v_result := jsonb_build_object(
      'status', 'ALREADY_RECORDED',
      'message', format('Simultaneous scan detected: Already confirmed as %s.', coalesce(v_existing.status, 'PRESENT')),
      'attendance_record', to_jsonb(v_existing)
    );

    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE attendance_operation_receipts
      SET status = 'COMPLETED',
          response_payload = v_result,
          attendance_id = v_existing.id,
          completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;

    RETURN v_result;
  ELSE
    RAISE;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT, TIMESTAMPTZ, VARCHAR, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT, TIMESTAMPTZ, VARCHAR, INT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. ATOMIC ATTENDANCE REVOCATION RPC: revoke_attendance
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_attendance(
  p_attendance_id UUID,
  p_reason TEXT,
  p_expected_version INT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_rec RECORD;
  v_role TEXT;
  v_officer_appt RECORD;
  v_rec RECORD;
  v_occurrence RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_reason TEXT;
  v_receipt_rec RECORD;
  v_fingerprint TEXT;
  v_result JSONB;
BEGIN
  -- 1. Authenticate caller (Fail-closed)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  -- 2. Validate account status
  SELECT * INTO v_user_rec FROM users WHERE id = v_user_id;
  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Account is suspended, inactive, or not found.');
  END IF;

  -- 3. Fail-closed role check (NULL rejected)
  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Officer privileges required.');
  END IF;

  -- 4. Mandatory Expected Version Precondition
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'VERSION_REQUIRED',
      'error', 'Expected version precondition is strictly required for attendance revocation.'
    );
  END IF;

  -- 5. Mandatory Reason Precondition
  v_clean_reason := trim(p_reason);
  IF v_clean_reason IS NULL OR length(v_clean_reason) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_REASON', 'error', 'A mandatory reason is required to revoke attendance.');
  END IF;

  -- 6. Lock attendance row
  SELECT * INTO v_rec
  FROM attendance_records
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'error', 'Attendance record not found.');
  END IF;

  -- 7. Officer Appointment & Scope Validation (Never touch v_officer_appt for DEVADMIN)
  IF v_role = 'OFFICER' THEN
    SELECT * INTO v_officer_appt
    FROM officer_appointments
    WHERE user_id = v_user_id
      AND status = 'ACTIVE'
      AND suspended_at IS NULL
      AND revoked_at IS NULL
      AND appointment_start <= v_now
      AND appointment_end >= v_now
      AND (
        permission_preset IN ('ATTENDANCE', 'FULL')
        OR custom_permissions ? 'ATTENDANCE'
        OR custom_permissions ? 'attendance'
      )
    ORDER BY appointment_end DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Active officer appointment with attendance permissions required.');
    END IF;

    -- Verify scope on occurrence
    SELECT eo.*, ev.id as parent_event_id, ev.semester_id
    INTO v_occurrence
    FROM event_occurrences eo
    JOIN events ev ON ev.id = eo.event_id
    WHERE eo.id = v_rec.occurrence_id;

    IF v_officer_appt.scope_type = 'EVENT' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF v_officer_appt.scope_id <> v_occurrence.parent_event_id::text THEN
        RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN_SCOPE', 'error', 'Attendance record is outside officer event scope.');
      END IF;
    ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM student_enrollments se 
        WHERE se.student_id = v_rec.student_id 
          AND se.program_id = v_officer_appt.scope_id
          AND se.semester_id = v_occurrence.semester_id::text
      ) THEN
        RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN_SCOPE', 'error', 'Attendance record student is outside officer program scope.');
      END IF;
    END IF;
  END IF;

  -- 8. True Transactional Idempotency Check
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    v_fingerprint := md5(p_attendance_id::text || ':' || p_expected_version::text || ':' || v_clean_reason);

    SELECT * INTO v_receipt_rec
    FROM attendance_operation_receipts
    WHERE idempotency_key = trim(p_idempotency_key)
    FOR UPDATE;

    IF FOUND THEN
      IF v_receipt_rec.user_id <> v_user_id THEN
        RETURN jsonb_build_object('success', false, 'status', 'IDEMPOTENCY_REUSE_FORBIDDEN', 'error', 'Idempotency key already used by another user.');
      END IF;
      IF v_receipt_rec.request_fingerprint <> v_fingerprint THEN
        RETURN jsonb_build_object('success', false, 'status', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'error', 'Idempotency key reused with different request payload.');
      END IF;
      IF v_receipt_rec.status IN ('COMPLETED', 'FAILED') THEN
        RETURN v_receipt_rec.response_payload || jsonb_build_object('is_replay', true);
      END IF;
    ELSE
      INSERT INTO attendance_operation_receipts (
        idempotency_key, user_id, operation_type, occurrence_id, student_id,
        attendance_id, request_fingerprint, status, created_at
      ) VALUES (
        trim(p_idempotency_key), v_user_id, 'REVOKE', v_rec.occurrence_id, v_rec.student_id,
        p_attendance_id, v_fingerprint, 'PROCESSING', v_now
      );
    END IF;
  END IF;

  -- 9. State Transition & Optimistic Concurrency Preconditions
  IF v_rec.status = 'REVOKED' THEN
    v_result := jsonb_build_object(
      'success', true, 
      'status', 'ALREADY_REVOKED', 
      'message', 'Attendance record is already revoked.',
      'attendance_record', to_jsonb(v_rec)
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE attendance_operation_receipts 
      SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  IF v_rec.version <> p_expected_version THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'STALE_STATE_CONFLICT',
      'error', format('Concurrency conflict: record version is %s, expected %s. Please refresh.', v_rec.version, p_expected_version),
      'current_version', v_rec.version,
      'attendance_record', to_jsonb(v_rec)
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 10. Atomic Transition to REVOKED
  UPDATE attendance_records
  SET status = 'REVOKED',
      revoked_at = v_now,
      revoked_by_user_id = v_user_id,
      revocation_reason = v_clean_reason,
      version = version + 1,
      updated_at = v_now
  WHERE id = p_attendance_id;

  -- 11. Append Immutable Audit Entry
  INSERT INTO attendance_audit (
    id, attendance_id, occurrence_id, student_id, action,
    old_status, new_status, reason, performed_by_user_id, performed_at
  ) VALUES (
    gen_random_uuid(), p_attendance_id, v_rec.occurrence_id, v_rec.student_id, 'REVOKE',
    v_rec.status, 'REVOKED', v_clean_reason, v_user_id, v_now
  );

  v_result := jsonb_build_object(
    'success', true,
    'status', 'REVOKED',
    'message', 'Attendance record successfully revoked with audit trail.',
    'attendance_record', jsonb_build_object(
      'id', p_attendance_id,
      'occurrence_id', v_rec.occurrence_id,
      'student_id', v_rec.student_id,
      'status', 'REVOKED',
      'revocation_reason', v_clean_reason,
      'revoked_at', v_now,
      'version', v_rec.version + 1
    )
  );

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    UPDATE attendance_operation_receipts 
    SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
    WHERE idempotency_key = trim(p_idempotency_key);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_attendance(UUID, TEXT, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_attendance(UUID, TEXT, INT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. ATOMIC ATTENDANCE RECHECK RPC: recheck_attendance
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recheck_attendance(
  p_attendance_id UUID,
  p_reason TEXT,
  p_target_status VARCHAR(20),
  p_expected_version INT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user_rec RECORD;
  v_role TEXT;
  v_officer_appt RECORD;
  v_rec RECORD;
  v_occurrence RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_reason TEXT;
  v_status VARCHAR(20);
  v_receipt_rec RECORD;
  v_fingerprint TEXT;
  v_result JSONB;
BEGIN
  -- 1. Authenticate caller (Fail-closed)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  -- 2. Validate account status
  SELECT * INTO v_user_rec FROM users WHERE id = v_user_id;
  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Account is suspended, inactive, or not found.');
  END IF;

  -- 3. Fail-closed role check (NULL rejected)
  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Officer privileges required.');
  END IF;

  -- 4. Mandatory Expected Version Precondition
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'VERSION_REQUIRED',
      'error', 'Expected version precondition is strictly required for attendance reinstatement.'
    );
  END IF;

  -- 5. Mandatory Reason Precondition
  v_clean_reason := trim(p_reason);
  IF v_clean_reason IS NULL OR length(v_clean_reason) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_REASON', 'error', 'A mandatory reason is required to recheck attendance.');
  END IF;

  v_status := CASE WHEN p_target_status IN ('PRESENT', 'LATE') THEN p_target_status ELSE 'PRESENT' END;

  -- 6. Lock attendance row
  SELECT * INTO v_rec
  FROM attendance_records
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'error', 'Attendance record not found.');
  END IF;

  -- 7. Officer Appointment & Scope Validation (Never touch v_officer_appt for DEVADMIN)
  IF v_role = 'OFFICER' THEN
    SELECT * INTO v_officer_appt
    FROM officer_appointments
    WHERE user_id = v_user_id
      AND status = 'ACTIVE'
      AND suspended_at IS NULL
      AND revoked_at IS NULL
      AND appointment_start <= v_now
      AND appointment_end >= v_now
      AND (
        permission_preset IN ('ATTENDANCE', 'FULL')
        OR custom_permissions ? 'ATTENDANCE'
        OR custom_permissions ? 'attendance'
      )
    ORDER BY appointment_end DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Active officer appointment with attendance permissions required.');
    END IF;

    -- Verify scope on occurrence
    SELECT eo.*, ev.id as parent_event_id, ev.semester_id
    INTO v_occurrence
    FROM event_occurrences eo
    JOIN events ev ON ev.id = eo.event_id
    WHERE eo.id = v_rec.occurrence_id;

    IF v_officer_appt.scope_type = 'EVENT' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF v_officer_appt.scope_id <> v_occurrence.parent_event_id::text THEN
        RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN_SCOPE', 'error', 'Attendance record is outside officer event scope.');
      END IF;
    ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM student_enrollments se 
        WHERE se.student_id = v_rec.student_id 
          AND se.program_id = v_officer_appt.scope_id
          AND se.semester_id = v_occurrence.semester_id::text
      ) THEN
        RETURN jsonb_build_object('success', false, 'status', 'FORBIDDEN_SCOPE', 'error', 'Attendance record student is outside officer program scope.');
      END IF;
    END IF;
  END IF;

  -- 8. True Transactional Idempotency Check
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    v_fingerprint := md5(p_attendance_id::text || ':' || p_expected_version::text || ':' || v_status || ':' || v_clean_reason);

    SELECT * INTO v_receipt_rec
    FROM attendance_operation_receipts
    WHERE idempotency_key = trim(p_idempotency_key)
    FOR UPDATE;

    IF FOUND THEN
      IF v_receipt_rec.user_id <> v_user_id THEN
        RETURN jsonb_build_object('success', false, 'status', 'IDEMPOTENCY_REUSE_FORBIDDEN', 'error', 'Idempotency key already used by another user.');
      END IF;
      IF v_receipt_rec.request_fingerprint <> v_fingerprint THEN
        RETURN jsonb_build_object('success', false, 'status', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'error', 'Idempotency key reused with different request payload.');
      END IF;
      IF v_receipt_rec.status IN ('COMPLETED', 'FAILED') THEN
        RETURN v_receipt_rec.response_payload || jsonb_build_object('is_replay', true);
      END IF;
    ELSE
      INSERT INTO attendance_operation_receipts (
        idempotency_key, user_id, operation_type, occurrence_id, student_id,
        attendance_id, request_fingerprint, status, created_at
      ) VALUES (
        trim(p_idempotency_key), v_user_id, 'RECHECK', v_rec.occurrence_id, v_rec.student_id,
        p_attendance_id, v_fingerprint, 'PROCESSING', v_now
      );
    END IF;
  END IF;

  -- 9. Verify Current State is REVOKED
  IF v_rec.status <> 'REVOKED' THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'NOT_REVOKED',
      'error', format('Attendance record status is %s; only REVOKED records can be reinstated.', v_rec.status),
      'attendance_record', to_jsonb(v_rec)
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 10. Optimistic Concurrency Check
  IF v_rec.version <> p_expected_version THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'STALE_STATE_CONFLICT',
      'error', format('Concurrency conflict: record version is %s, expected %s. Please refresh.', v_rec.version, p_expected_version),
      'current_version', v_rec.version,
      'attendance_record', to_jsonb(v_rec)
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 11. Atomic Transition to Target Status
  UPDATE attendance_records
  SET status = v_status,
      rechecked_at = v_now,
      rechecked_by_user_id = v_user_id,
      recheck_reason = v_clean_reason,
      version = version + 1,
      updated_at = v_now
  WHERE id = p_attendance_id;

  -- 12. Append Immutable Audit Entry
  INSERT INTO attendance_audit (
    id, attendance_id, occurrence_id, student_id, action,
    old_status, new_status, reason, performed_by_user_id, performed_at
  ) VALUES (
    gen_random_uuid(), p_attendance_id, v_rec.occurrence_id, v_rec.student_id, 'RECHECK_APPROVED',
    'REVOKED', v_status, v_clean_reason, v_user_id, v_now
  );

  v_result := jsonb_build_object(
    'success', true,
    'status', 'REINSTATED',
    'message', format('Attendance successfully reinstated as %s.', v_status),
    'attendance_record', jsonb_build_object(
      'id', p_attendance_id,
      'occurrence_id', v_rec.occurrence_id,
      'student_id', v_rec.student_id,
      'status', v_status,
      'version', v_rec.version + 1,
      'rechecked_at', v_now
    )
  );

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    UPDATE attendance_operation_receipts 
    SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
    WHERE idempotency_key = trim(p_idempotency_key);
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recheck_attendance(UUID, TEXT, VARCHAR, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recheck_attendance(UUID, TEXT, VARCHAR, INT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. STRICT EXPLICIT ALLOWLIST IN SYNC PUSH BATCH (All App Entities Handled)
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
BEGIN
  -- Strict caller verification (Fail-closed)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT * INTO v_user_rec FROM users WHERE id = v_user_id;
  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Caller account is suspended or inactive.';
  END IF;

  SELECT role INTO v_role
  FROM user_roles
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
    FROM officer_appointments
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
       OR v_officer_appt.custom_permissions ? 'FINANCE'
       OR v_officer_appt.custom_permissions ? 'finance' THEN
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
      -- STRICT EXPLICIT ALLOWLIST (No dynamic SQL fallback)

      -- 1. ATTENDANCE (CREATE / UPDATE): Routes strictly to record_attendance_scan
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

      -- 2. ATTENDANCE (VOID / REVOKE): Routes to revoke_attendance with mandatory version
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

      -- 3. ATTENDANCE_VOID: Routes to revoke_attendance
      ELSIF v_entity_type = 'ATTENDANCE_VOID' THEN
        IF v_payload->>'version' IS NULL THEN
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', 'Version is required for attendance void push.');
          CONTINUE;
        END IF;

        v_revoke_res := public.revoke_attendance(
          (v_payload->>'attendance_id')::uuid,
          coalesce(v_payload->>'reason', 'Offline void request'),
          (v_payload->>'version')::int,
          v_outbox_id
        );

        IF (v_revoke_res->>'success')::boolean = true OR (v_revoke_res->>'status') = 'ALREADY_REVOKED' THEN
          v_applied := v_applied + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED', 'revoke_result', v_revoke_res);
        ELSE
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', coalesce(v_revoke_res->>'error', v_revoke_res->>'message'));
        END IF;
        CONTINUE;

      -- 4. ATTENDANCE_ATTEMPT: Append-only log
      ELSIF v_entity_type = 'ATTENDANCE_ATTEMPT' AND v_operation = 'CREATE' THEN
        INSERT INTO attendance_attempts (
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

      -- 5. STUDENT: Create or Update (whitelisted profile fields)
      ELSIF v_entity_type = 'STUDENT' THEN
        IF v_operation = 'CREATE' THEN
          IF v_role <> 'DEVADMIN' AND (v_officer_appt IS NULL OR v_officer_appt.status <> 'ACTIVE') THEN
            RAISE EXCEPTION 'Unauthorized: Officer appointment required to register students.';
          END IF;
          INSERT INTO students (
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
          UPDATE students
          SET photo_local_uri = coalesce(v_payload->>'photo_local_uri', photo_local_uri),
              photo_storage_path = coalesce(v_payload->>'photo_storage_path', photo_storage_path),
              updated_at = now()
          WHERE id = v_entity_id::uuid;
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 6. ENROLLMENT: Student term enrollments
      ELSIF v_entity_type = 'ENROLLMENT' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO student_enrollments (
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

      -- 7. CARD: NFC Card assignment
      ELSIF v_entity_type = 'CARD' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO nfc_cards (
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

      -- 8. EVENT, EVENT_CATEGORY, OCCURRENCE, PARTICIPANT
      ELSIF v_entity_type = 'EVENT' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        INSERT INTO events (
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
        INSERT INTO event_categories (id, name, description, code, status, created_at, updated_at)
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
        INSERT INTO event_occurrences (
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
        INSERT INTO event_participants (
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

      -- 9. FINANCE: OBLIGATION_RULE, OBLIGATION, PAYMENT, PAYMENT_ALLOCATION
      ELSIF v_entity_type IN ('OBLIGATION_RULE', 'OBLIGATION', 'PAYMENT', 'PAYMENT_ALLOCATION') THEN
        IF NOT v_has_finance_perm THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks finance permissions for % entity push.', v_entity_type;
        END IF;

        IF v_entity_type = 'OBLIGATION_RULE' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
          INSERT INTO obligation_rules (
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

        ELSIF v_entity_type = 'OBLIGATION' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
          INSERT INTO student_obligations (
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

        ELSIF v_entity_type = 'PAYMENT' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
          INSERT INTO payments (
            id, student_id, semester_id, reference_number, idempotency_key,
            amount_centavos, source, channel, status, processed_by_user_id,
            processed_at, updated_at
          ) VALUES (
            v_entity_id::uuid,
            (v_payload->>'student_id')::uuid,
            v_payload->>'semester_id',
            coalesce(v_payload->>'reference_number', v_payload->>'receipt_number', gen_random_uuid()::text),
            coalesce(v_payload->>'idempotency_key', v_outbox_id),
            coalesce((v_payload->>'amount_centavos')::bigint, (v_payload->>'total_amount_centavos')::bigint, 0),
            coalesce(v_payload->>'source', 'MANUAL'),
            coalesce(v_payload->>'channel', v_payload->>'payment_method', 'CASH'),
            coalesce(v_payload->>'status', 'POSTED'),
            v_user_id,
            coalesce((v_payload->>'processed_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO NOTHING;

        ELSIF v_entity_type = 'PAYMENT_ALLOCATION' AND v_operation = 'CREATE' THEN
          INSERT INTO payment_allocations (
            id, payment_id, obligation_id, amount_centavos, created_at
          ) VALUES (
            v_entity_id::uuid,
            (v_payload->>'payment_id')::uuid,
            (v_payload->>'obligation_id')::uuid,
            coalesce((v_payload->>'amount_centavos')::bigint, (v_payload->>'allocated_amount_centavos')::bigint, 0),
            coalesce((v_payload->>'created_at')::timestamptz, now())
          ) ON CONFLICT (id) DO NOTHING;
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
          INSERT INTO academic_years (id, label, starts_on, ends_on, status, created_at, updated_at)
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
          INSERT INTO semesters (id, academic_year_id, term, starts_on, ends_on, status, created_at, updated_at)
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
            status = EXCLUDED.status,
            updated_at = now();

        ELSIF v_entity_type = 'PROGRAM' THEN
          INSERT INTO programs (id, code, name, status)
          VALUES (
            v_entity_id,
            v_payload->>'code',
            v_payload->>'name',
            coalesce(v_payload->>'status', 'ACTIVE')
          ) ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            status = EXCLUDED.status;

        ELSIF v_entity_type = 'YEAR_LEVEL' THEN
          INSERT INTO year_levels (id, level_number, display_name, status, created_at, updated_at)
          VALUES (
            v_entity_id,
            coalesce((v_payload->>'level_number')::int, 1),
            v_payload->>'display_name',
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            status = EXCLUDED.status,
            updated_at = now();

        ELSIF v_entity_type = 'SECTION' THEN
          INSERT INTO sections (id, section_name, year_level_id, program_id, academic_year_id, status, created_at, updated_at)
          VALUES (
            v_entity_id::uuid,
            v_payload->>'section_name',
            v_payload->>'year_level_id',
            v_payload->>'program_id',
            v_payload->>'academic_year_id',
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, now()),
            now()
          ) ON CONFLICT (id) DO UPDATE SET
            section_name = EXCLUDED.section_name,
            status = EXCLUDED.status,
            updated_at = now();
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- REJECT ALL OTHER ARBITRARY ENTITY TYPES
      ELSE
        v_failed := v_failed + 1;
        v_results := v_results || jsonb_build_object(
          'id', v_outbox_id, 
          'status', 'REJECTED_FINAL', 
          'error', format('Entity type %s with operation %s is not permitted via sync push.', v_entity_type, v_operation)
        );
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'ERROR', 'error', SQLERRM);
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

-- ------------------------------------------------------------------------------
-- 9. DETERMINISTIC CURSOR PAGINATION & SCOPED BATCH PULL: sync_pull_batch
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.sync_pull_batch(timestamptz, integer);
DROP FUNCTION IF EXISTS public.sync_pull_batch(timestamptz, integer, uuid);

CREATE OR REPLACE FUNCTION public.sync_pull_batch(
  p_since timestamptz DEFAULT '1970-01-01 00:00:00+00'::timestamptz,
  p_limit integer DEFAULT 500,
  p_last_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_user_id UUID;
  v_student_id UUID;
  v_officer_appt RECORD;
  v_officer_scope_type TEXT := NULL;
  v_officer_scope_id TEXT := NULL;
  v_clamped_limit INT := least(greatest(p_limit, 1), 1000);
  v_att_records JSONB;
  v_att_count INT;
  v_has_more BOOLEAN := false;
  v_next_cursor_id UUID := NULL;
  v_next_since TIMESTAMPTZ := NULL;
BEGIN
  -- 1. Fail-closed authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: User has no active roles.';
  END IF;

  SELECT student_id INTO v_student_id
  FROM users
  WHERE id = v_user_id;

  -- 2. Safely populate officer appointment (Never unassigned when checked)
  IF v_role = 'OFFICER' THEN
    SELECT * INTO v_officer_appt
    FROM officer_appointments
    WHERE user_id = v_user_id
      AND status = 'ACTIVE'
      AND suspended_at IS NULL
      AND revoked_at IS NULL
      AND appointment_start <= now()
      AND appointment_end >= now()
    ORDER BY appointment_end DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unauthorized: Officer appointment is inactive, suspended, or expired.';
    END IF;

    v_officer_scope_type := v_officer_appt.scope_type;
    v_officer_scope_id := v_officer_appt.scope_id;
  END IF;

  -- 3. Attendance Records: Deterministic cursor pagination (updated_at, id)
  SELECT 
    coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb),
    count(*)
  INTO v_att_records, v_att_count
  FROM (
    SELECT ar.*
    FROM attendance_records ar
    JOIN event_occurrences eo ON eo.id = ar.occurrence_id
    WHERE (
      (ar.updated_at > p_since) OR
      (ar.updated_at = p_since AND (p_last_id IS NULL OR ar.id > p_last_id))
    )
    AND (
      v_role = 'DEVADMIN' OR
      (v_role = 'STUDENT' AND ar.student_id = v_student_id) OR
      (v_role = 'OFFICER' AND (
        v_officer_scope_type = 'ORGANIZATION' OR
        (v_officer_scope_type = 'EVENT' AND eo.event_id::text = v_officer_scope_id) OR
        (v_officer_scope_type = 'PROGRAM' AND EXISTS (
          SELECT 1 FROM student_enrollments se 
          WHERE se.student_id = ar.student_id AND se.program_id = v_officer_scope_id
        )) OR
        (v_officer_scope_type = 'SECTION' AND EXISTS (
          SELECT 1 FROM student_enrollments se 
          WHERE se.student_id = ar.student_id AND se.section_id::text = v_officer_scope_id
        ))
      ))
    )
    ORDER BY ar.updated_at ASC, ar.id ASC
    LIMIT (v_clamped_limit + 1)
  ) t;

  -- Real continuation pagination metadata
  IF v_att_count > v_clamped_limit THEN
    v_has_more := true;
    v_att_records := v_att_records - (v_att_count - 1);
    v_next_cursor_id := (v_att_records->(v_clamped_limit - 1)->>'id')::uuid;
    v_next_since := (v_att_records->(v_clamped_limit - 1)->>'updated_at')::timestamptz;
  ELSE
    v_has_more := false;
    IF v_att_count > 0 THEN
      v_next_cursor_id := (v_att_records->(v_att_count - 1)->>'id')::uuid;
      v_next_since := (v_att_records->(v_att_count - 1)->>'updated_at')::timestamptz;
    ELSE
      v_next_since := p_since;
      v_next_cursor_id := p_last_id;
    END IF;
  END IF;

  -- 4. Construct comprehensive role-scoped payload
  RETURN jsonb_build_object(
    'server_time', now(),
    'pagination', jsonb_build_object(
      'since', p_since,
      'limit', v_clamped_limit,
      'last_id', p_last_id,
      'has_more', v_has_more,
      'next_cursor', jsonb_build_object(
        'since', v_next_since,
        'last_id', v_next_cursor_id
      )
    ),
    'academic_years', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM academic_years 
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id::text)))
        ORDER BY updated_at ASC, id ASC LIMIT v_clamped_limit
      ) t
    ),
    'semesters', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM semesters 
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id::text)))
        ORDER BY updated_at ASC, id ASC LIMIT v_clamped_limit
      ) t
    ),
    'programs', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM programs 
        ORDER BY id ASC LIMIT v_clamped_limit
      ) t
    ),
    'year_levels', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM year_levels 
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id::text)))
        ORDER BY updated_at ASC, id ASC LIMIT v_clamped_limit
      ) t
    ),
    'sections', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM sections 
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id)))
        ORDER BY updated_at ASC, id ASC LIMIT v_clamped_limit
      ) t
    ),
    'event_categories', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM event_categories 
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id)))
        ORDER BY updated_at ASC, id ASC LIMIT v_clamped_limit
      ) t
    ),
    'events', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT ev.* FROM events ev
        WHERE (ev.updated_at > p_since OR (ev.updated_at = p_since AND (p_last_id IS NULL OR ev.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            v_role = 'STUDENT' OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type IN ('ORGANIZATION', 'PROGRAM', 'SECTION') OR
              (v_officer_scope_type = 'EVENT' AND ev.id::text = v_officer_scope_id)
            ))
          )
        ORDER BY ev.updated_at ASC, ev.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'event_occurrences', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT eo.* FROM event_occurrences eo
        JOIN events ev ON ev.id = eo.event_id
        WHERE (eo.updated_at > p_since OR (eo.updated_at = p_since AND (p_last_id IS NULL OR eo.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            v_role = 'STUDENT' OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type IN ('ORGANIZATION', 'PROGRAM', 'SECTION') OR
              (v_officer_scope_type = 'EVENT' AND eo.event_id::text = v_officer_scope_id)
            ))
          )
        ORDER BY eo.updated_at ASC, eo.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'event_participants', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT ep.* FROM event_participants ep
        JOIN event_occurrences eo ON eo.id = ep.occurrence_id
        WHERE (ep.updated_at > p_since OR (ep.updated_at = p_since AND (p_last_id IS NULL OR ep.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND ep.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type IN ('ORGANIZATION', 'PROGRAM', 'SECTION') OR
              (v_officer_scope_type = 'EVENT' AND eo.event_id::text = v_officer_scope_id)
            ))
          )
        ORDER BY ep.updated_at ASC, ep.id ASC LIMIT v_clamped_limit
      ) t
    ),
    -- Students: EVENT-scoped officers strictly receive ONLY students who are participants in their assigned event!
    'students', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT stu.* FROM students stu
        WHERE (stu.updated_at > p_since OR (stu.updated_at = p_since AND (p_last_id IS NULL OR stu.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND stu.id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = stu.id AND se.program_id = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'SECTION' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = stu.id AND se.section_id::text = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'EVENT' AND EXISTS (
                SELECT 1 FROM event_participants ep
                JOIN event_occurrences eo ON eo.id = ep.occurrence_id
                WHERE ep.student_id = stu.id AND eo.event_id::text = v_officer_scope_id
              ))
            ))
          )
        ORDER BY stu.updated_at ASC, stu.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'student_enrollments', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT se.* FROM student_enrollments se
        WHERE (se.updated_at > p_since OR (se.updated_at = p_since AND (p_last_id IS NULL OR se.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND se.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'PROGRAM' AND se.program_id = v_officer_scope_id) OR
              (v_officer_scope_type = 'SECTION' AND se.section_id::text = v_officer_scope_id) OR
              (v_officer_scope_type = 'EVENT' AND EXISTS (
                SELECT 1 FROM event_participants ep
                JOIN event_occurrences eo ON eo.id = ep.occurrence_id
                WHERE ep.student_id = se.student_id AND eo.event_id::text = v_officer_scope_id
              ))
            ))
          )
        ORDER BY se.updated_at ASC, se.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'nfc_cards', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT nc.* FROM nfc_cards nc
        WHERE (nc.updated_at > p_since OR (nc.updated_at = p_since AND (p_last_id IS NULL OR nc.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND nc.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = nc.student_id AND se.program_id = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'SECTION' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = nc.student_id AND se.section_id::text = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'EVENT' AND EXISTS (
                SELECT 1 FROM event_participants ep
                JOIN event_occurrences eo ON eo.id = ep.occurrence_id
                WHERE ep.student_id = nc.student_id AND eo.event_id::text = v_officer_scope_id
              ))
            ))
          )
        ORDER BY nc.updated_at ASC, nc.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'attendance_records', v_att_records,
    'attendance_audit', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT 
          aa.id,
          aa.attendance_id,
          aa.occurrence_id,
          aa.student_id,
          aa.action,
          aa.old_status,
          aa.new_status,
          CASE 
            WHEN v_role = 'STUDENT' THEN 'Record status update'
            ELSE aa.reason
          END AS reason,
          CASE 
            WHEN v_role = 'STUDENT' THEN NULL
            ELSE aa.performed_by_user_id
          END AS performed_by_user_id,
          aa.performed_at
        FROM attendance_audit aa
        JOIN attendance_records ar ON ar.id = aa.attendance_id
        JOIN event_occurrences eo ON eo.id = ar.occurrence_id
        WHERE (aa.performed_at > p_since OR (aa.performed_at = p_since AND (p_last_id IS NULL OR aa.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND ar.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'EVENT' AND eo.event_id::text = v_officer_scope_id) OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = ar.student_id AND se.program_id = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'SECTION' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = ar.student_id AND se.section_id::text = v_officer_scope_id
              ))
            ))
          )
        ORDER BY aa.performed_at ASC, aa.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'obligation_rules', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT obr.* FROM obligation_rules obr
        WHERE (obr.updated_at > p_since OR (obr.updated_at = p_since AND (p_last_id IS NULL OR obr.id > p_last_id)))
        ORDER BY obr.updated_at ASC, obr.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'student_obligations', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT so.* FROM student_obligations so
        WHERE (so.updated_at > p_since OR (so.updated_at = p_since AND (p_last_id IS NULL OR so.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND so.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = so.student_id AND se.program_id = v_officer_scope_id
              ))
            ))
          )
        ORDER BY so.updated_at ASC, so.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'payments', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT pay.* FROM payments pay
        WHERE (coalesce(pay.updated_at, pay.processed_at) > p_since OR (coalesce(pay.updated_at, pay.processed_at) = p_since AND (p_last_id IS NULL OR pay.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND pay.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = pay.student_id AND se.program_id = v_officer_scope_id
              ))
            ))
          )
        ORDER BY coalesce(pay.updated_at, pay.processed_at) ASC, pay.id ASC LIMIT v_clamped_limit
      ) t
    ),
    'payment_allocations', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT pa.* FROM payment_allocations pa
        JOIN payments pay ON pay.id = pa.payment_id
        WHERE (pa.created_at > p_since OR (pa.created_at = p_since AND (p_last_id IS NULL OR pa.id > p_last_id)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND pay.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = pay.student_id AND se.program_id = v_officer_scope_id
              ))
            ))
          )
        ORDER BY pa.created_at ASC, pa.id ASC LIMIT v_clamped_limit
      ) t
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_pull_batch(timestamptz, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_pull_batch(timestamptz, integer, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. TEXT-COMPATIBLE OVERLOADS FOR STUDENT ACTIVATION RPCS (Resolves 22P02 error)
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.officer_issue_activation_code(UUID, TEXT, INT);
DROP FUNCTION IF EXISTS public.officer_issue_activation_code(TEXT, TEXT, INT);
DROP FUNCTION IF EXISTS public.officer_get_student_activation_status(UUID);
DROP FUNCTION IF EXISTS public.officer_get_student_activation_status(TEXT);

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
  v_caller_role RECORD;
  v_student RECORD;
  v_student_uuid UUID;
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

  -- Flexible resolution: checks UUID format or school_id
  IF p_student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_student FROM students WHERE id = p_student_id::uuid;
  ELSE
    SELECT * INTO v_student FROM students WHERE school_id = p_student_id;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', format('Student record %s not found.', p_student_id));
  END IF;

  v_student_uuid := v_student.id;

  -- Revoke any existing pending claims
  IF EXISTS (SELECT 1 FROM activation_claims WHERE student_id = v_student_uuid AND used_at IS NULL AND revoked_at IS NULL) THEN
    UPDATE activation_claims 
    SET revoked_at = now() 
    WHERE student_id = v_student_uuid AND used_at IS NULL AND revoked_at IS NULL;
    v_action := 'REISSUED';
  END IF;

  v_expires_at := now() + (p_expires_hours || ' hours')::INTERVAL;
  v_new_claim_id := gen_random_uuid();

  INSERT INTO activation_claims (
    id, student_id, token_hash, issued_by_user_id, expires_at, created_at, attempt_count, max_attempts
  ) VALUES (
    v_new_claim_id, v_student_uuid, p_token_hash, auth.uid(), v_expires_at, now(), 0, 5
  );

  INSERT INTO activation_claims_audit (
    claim_id, student_id, action, performed_by_user_id, notes
  ) VALUES (
    v_new_claim_id, v_student_uuid, v_action, auth.uid(), format('Code %s with expiration in %s hours', lower(v_action), p_expires_hours)
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

CREATE OR REPLACE FUNCTION public.officer_get_student_activation_status(
  p_student_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_student_uuid UUID;
  v_user RECORD;
  v_claim RECORD;
  v_status TEXT := 'NOT_ACTIVATED';
BEGIN
  IF p_student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_student FROM students WHERE id = p_student_id::uuid;
  ELSE
    SELECT * INTO v_student FROM students WHERE school_id = p_student_id;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'error', 'Student not found.');
  END IF;

  v_student_uuid := v_student.id;

  SELECT * INTO v_user FROM users WHERE student_id = v_student_uuid;
  IF FOUND AND v_user.account_status = 'ACTIVE' THEN
    v_status := 'ACTIVATED';
  ELSE
    SELECT * INTO v_claim 
    FROM activation_claims 
    WHERE student_id = v_student_uuid 
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

  RETURN jsonb_build_object(
    'status', v_status,
    'student_id', v_student_uuid,
    'claim_id', v_claim.id,
    'expires_at', v_claim.expires_at,
    'attempt_count', coalesce(v_claim.attempt_count, 0),
    'max_attempts', coalesce(v_claim.max_attempts, 5),
    'linked_user_id', v_user.id,
    'linked_username', v_user.username
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.officer_get_student_activation_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.officer_get_student_activation_status(TEXT) TO authenticated;

-- Public / Anonymous Student Activation Pre-check RPC
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
  v_clean_school_id := trim(p_school_id);

  SELECT * INTO v_student 
  FROM students 
  WHERE (lower(school_id) = lower(v_clean_school_id) OR id::text = v_clean_school_id)
    AND status = 'ACTIVE'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student record not found for this School ID.');
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE student_id = v_student.id AND account_status = 'ACTIVE') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This student record has already been activated. Please sign in.');
  END IF;

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
    'school_id', v_student.school_id,
    'student_name', trim(v_student.first_name || ' ' || v_student.last_name)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.validate_activation_code(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_activation_code(TEXT, TEXT) TO anon, authenticated;

-- Atomic Server-Side Student Account Activation RPC
CREATE OR REPLACE FUNCTION public.activate_student_account(
  p_school_id TEXT,
  p_token_hash TEXT,
  p_auth_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  SELECT * INTO v_student 
  FROM students 
  WHERE (lower(school_id) = lower(v_clean_school_id) OR id::text = v_clean_school_id)
    AND status = 'ACTIVE'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code or school ID.');
  END IF;

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

  IF EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND student_id IS NOT NULL AND student_id <> v_student.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account is already linked to another student record.');
  END IF;

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

  IF v_claim.attempt_count >= v_claim.max_attempts THEN
    UPDATE activation_claims SET revoked_at = now() WHERE id = v_claim.id;
    INSERT INTO activation_claims_audit (claim_id, student_id, action, notes)
    VALUES (v_claim.id, v_student.id, 'REVOKED', 'Exceeded maximum failed activation attempts');
    RETURN jsonb_build_object('success', false, 'error', 'Too many failed activation attempts. Code revoked. Please request a new one from an officer.');
  END IF;

  IF v_claim.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This activation code has expired. Please request a new one from an officer.');
  END IF;

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

    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code or school ID.');
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.activate_student_account(TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_student_account(TEXT, TEXT, UUID) TO authenticated;



-- ------------------------------------------------------------------------------
-- 11. SUPABASE REALTIME PUBLICATION REGISTRATION
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_records'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_records;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables 
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attendance_audit'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance_audit;
    END IF;
  END IF;
END $$;
