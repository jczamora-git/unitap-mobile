-- UniTap 2.0 PostgreSQL / Supabase Initial Schema & Hybrid Sync Infrastructure
-- Migration: 20261031000001_unitap_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. ACADEMIC DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semesters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  term VARCHAR(20) NOT NULL, -- 'FIRST', 'SECOND', 'SUMMER'
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'INACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS only_one_active_semester_pg 
  ON semesters(status) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
);

-- ============================================================================
-- 2. STUDENT & ENROLLMENT DOMAIN
-- ============================================================================

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id VARCHAR(50) NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  photo_storage_path TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  program_id UUID REFERENCES programs(id),
  year_level INT NOT NULL CHECK (year_level BETWEEN 1 AND 8),
  section TEXT NOT NULL,
  enrollment_status VARCHAR(20) NOT NULL DEFAULT 'ENROLLED',
  first_name_snapshot TEXT NOT NULL,
  middle_name_snapshot TEXT,
  last_name_snapshot TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, semester_id)
);

CREATE TABLE IF NOT EXISTS profile_confirmations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  submitted_payload JSONB,
  reviewed_by_user_id UUID,
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. USERS, ROLES & SECURITY
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL, -- 'DEVADMIN', 'OFFICER', 'STUDENT'
  semester_id UUID REFERENCES semesters(id),
  assigned_by_user_id UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name TEXT NOT NULL,
  device_code VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  provisioned_by_user_id UUID REFERENCES users(id),
  provisioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS activation_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_by_user_id UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nfc_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  uid_normalized VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ,
  note TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nfc_active_uid_pg 
  ON nfc_cards(uid_normalized) WHERE status = 'ACTIVE';

-- ============================================================================
-- 4. EVENTS & ATTENDANCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  audience_type VARCHAR(20) NOT NULL DEFAULT 'ALL',
  audience_json JSONB,
  attendance_required INT NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_occurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  occurs_on DATE NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  grace_minutes INT NOT NULL DEFAULT 15,
  status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES event_occurrences(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  attendance_required INT NOT NULL DEFAULT 1,
  excused INT NOT NULL DEFAULT 0,
  excuse_reason TEXT,
  excused_by_user_id UUID REFERENCES users(id),
  UNIQUE (occurrence_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID NOT NULL REFERENCES event_occurrences(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL, -- 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  method VARCHAR(20) NOT NULL DEFAULT 'NFC',
  photo_checked INT NOT NULL DEFAULT 1,
  identity_verified_by_user_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (occurrence_id, student_id)
);

CREATE TABLE IF NOT EXISTS attendance_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id UUID REFERENCES event_occurrences(id) ON DELETE CASCADE,
  card_uid VARCHAR(64) NOT NULL,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  result VARCHAR(30) NOT NULL,
  reason TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID REFERENCES attendance_records(id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  reason TEXT NOT NULL,
  performed_by_user_id UUID NOT NULL REFERENCES users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 5. FINES, CONTRIBUTIONS & WALLET LEDGER
-- ============================================================================

CREATE TABLE IF NOT EXISTS obligation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type VARCHAR(20) NOT NULL, -- 'FINE', 'CONTRIBUTION'
  trigger_type VARCHAR(20) NOT NULL,
  default_amount_centavos BIGINT NOT NULL CHECK (default_amount_centavos >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES obligation_rules(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  type VARCHAR(20) NOT NULL,
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  due_date DATE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS obligation_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id UUID NOT NULL REFERENCES student_obligations(id) ON DELETE CASCADE,
  adjustment_type VARCHAR(20) NOT NULL, -- 'WAIVE', 'DISCOUNT'
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos >= 0),
  reason TEXT NOT NULL,
  authorized_by_user_id UUID NOT NULL REFERENCES users(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  reference_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos > 0),
  source VARCHAR(30) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  status VARCHAR(20) NOT NULL DEFAULT 'POSTED',
  processed_by_user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  reversed_at TIMESTAMPTZ,
  reversed_by_user_id UUID REFERENCES users(id),
  reversal_reason TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  obligation_id UUID NOT NULL REFERENCES student_obligations(id) ON DELETE CASCADE,
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos > 0),
  UNIQUE (payment_id, obligation_id)
);

CREATE TABLE IF NOT EXISTS simulated_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS simulated_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES simulated_wallets(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL, -- 'TOP_UP', 'PAYMENT', 'PAYMENT_REVERSAL'
  amount_centavos BIGINT NOT NULL CHECK (amount_centavos > 0),
  related_payment_id UUID REFERENCES payments(id),
  reference_number TEXT NOT NULL,
  processed_by_user_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 6. AUDIT & HYBRID SYNCHRONIZATION INFRASTRUCTURE
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type VARCHAR(50) NOT NULL,
  entity_id TEXT NOT NULL,
  action VARCHAR(50) NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  payload_json JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server Monotonic Change Log for Pull Synchronization
CREATE TABLE IF NOT EXISTS sync_change_log (
  cursor BIGSERIAL PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  record_id UUID NOT NULL,
  operation VARCHAR(10) NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  payload JSONB NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_change_log_cursor ON sync_change_log(cursor);

-- Durable receipt tracking for client idempotency
CREATE TABLE IF NOT EXISTS sync_operation_receipts (
  idempotency_key TEXT PRIMARY KEY,
  device_id UUID REFERENCES devices(id),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL, -- 'APPLIED', 'REJECTED', 'DUPLICATE'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES devices(id),
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  conflict_type VARCHAR(50) NOT NULL,
  client_payload JSONB NOT NULL,
  server_payload JSONB,
  resolution VARCHAR(30) NOT NULL, -- 'SERVER_WINS', 'CLIENT_WINS', 'MANUAL_REQUIRED'
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 7. SECURE RPC FUNCTIONS FOR HYBRID SYNC
-- ============================================================================

-- A. Student Account Activation Claim Verification
CREATE OR REPLACE FUNCTION verify_and_claim_student_code(
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
BEGIN
  -- 1. Find student
  SELECT * INTO v_student FROM students WHERE school_id = p_school_id AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student record not found or inactive.');
  END IF;

  -- 2. Verify claim
  SELECT * INTO v_claim 
  FROM activation_claims 
  WHERE student_id = v_student.id 
    AND token_hash = p_token_hash 
    AND used_at IS NULL 
    AND revoked_at IS NULL 
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid, expired, or already used activation code.');
  END IF;

  -- 3. Mark claim used
  UPDATE activation_claims SET used_at = now() WHERE id = v_claim.id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student.id,
    'first_name', v_student.first_name,
    'last_name', v_student.last_name
  );
END;
$$;

-- B. Monotonic Pull Sync Endpoint
CREATE OR REPLACE FUNCTION sync_pull_changes(
  p_since_cursor BIGINT DEFAULT 0,
  p_limit INT DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_changes JSONB;
  v_max_cursor BIGINT;
  v_has_more BOOLEAN;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
  INTO v_changes
  FROM (
    SELECT cursor, table_name, record_id, operation, payload, changed_at
    FROM sync_change_log
    WHERE cursor > p_since_cursor
    ORDER BY cursor ASC
    LIMIT p_limit
  ) c;

  SELECT coalesce(max(cursor), p_since_cursor) INTO v_max_cursor
  FROM (
    SELECT cursor FROM sync_change_log WHERE cursor > p_since_cursor ORDER BY cursor ASC LIMIT p_limit
  ) m;

  SELECT count(*) > 0 INTO v_has_more
  FROM sync_change_log
  WHERE cursor > v_max_cursor;

  RETURN jsonb_build_object(
    'changes', v_changes,
    'next_cursor', v_max_cursor,
    'has_more', v_has_more
  );
END;
$$;

