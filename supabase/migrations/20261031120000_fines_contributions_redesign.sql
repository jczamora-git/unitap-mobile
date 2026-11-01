-- ============================================================================
-- UniTap 2.0 Fines & Contributions Redesign Migration
-- Migration: 20261031120000_fines_contributions_redesign.sql
-- Description:
--   1. Retires simulated wallet and ledger workflows (deprecated for legacy audit).
--   2. Adds event/occurrence/batch references to student_obligations.
--   3. Adds partial unique index preventing duplicate active absence fines.
--   4. Configures RLS policies and secure server functions for payment records and bulk assessment.
-- ============================================================================

-- 1. DEPRECATE SIMULATED WALLET TABLES
COMMENT ON TABLE simulated_wallets IS 'DEPRECATED: UniTap 2.0 uses direct cash and transfer payment records instead of digital wallet.';
COMMENT ON TABLE simulated_wallet_ledger IS 'DEPRECATED: Retained strictly for legacy transaction history and audit.';

-- 2. ENHANCE student_obligations TABLE
ALTER TABLE student_obligations ADD COLUMN IF NOT EXISTS related_event_id UUID REFERENCES events(id) ON DELETE SET NULL;
ALTER TABLE student_obligations ADD COLUMN IF NOT EXISTS related_occurrence_id UUID REFERENCES event_occurrences(id) ON DELETE SET NULL;
ALTER TABLE student_obligations ADD COLUMN IF NOT EXISTS issued_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE student_obligations ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE student_obligations ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE student_obligations ADD COLUMN IF NOT EXISTS void_reason TEXT;

-- Prevent duplicate active absence fines for the same student, occurrence, and rule
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_absence_obligation
  ON student_obligations (student_id, rule_id, related_occurrence_id)
  WHERE related_occurrence_id IS NOT NULL AND rule_id IS NOT NULL AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_obligations_batch ON student_obligations(batch_id);
CREATE INDEX IF NOT EXISTS idx_obligations_occurrence ON student_obligations(related_occurrence_id);

-- 3. ENHANCE payments TABLE
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT;

-- 4. ENHANCE event_participants INDEX
CREATE INDEX IF NOT EXISTS idx_event_participants_req
  ON event_participants (occurrence_id, attendance_required, excused);

-- ============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Helper: Get caller role securely
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM user_roles
  WHERE user_id = auth.uid()
    AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;
$$;

-- Enable RLS
ALTER TABLE obligation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligation_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;

-- A. obligation_rules
CREATE POLICY obligation_rules_officer_devadmin ON obligation_rules
  FOR ALL TO authenticated
  USING (get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY obligation_rules_read_all ON obligation_rules
  FOR SELECT TO authenticated
  USING (status = 'ACTIVE');

-- B. student_obligations
CREATE POLICY student_obligations_officer_devadmin ON student_obligations
  FOR ALL TO authenticated
  USING (get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY student_obligations_student_read ON student_obligations
  FOR SELECT TO authenticated
  USING (
    student_id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

-- C. obligation_adjustments
CREATE POLICY obligation_adjustments_officer_devadmin ON obligation_adjustments
  FOR ALL TO authenticated
  USING (get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY obligation_adjustments_student_read ON obligation_adjustments
  FOR SELECT TO authenticated
  USING (
    obligation_id IN (
      SELECT id FROM student_obligations
      WHERE student_id = (SELECT student_id FROM users WHERE id = auth.uid())
    )
  );

-- D. payments
CREATE POLICY payments_officer_devadmin ON payments
  FOR ALL TO authenticated
  USING (get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY payments_student_read ON payments
  FOR SELECT TO authenticated
  USING (
    student_id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

-- E. payment_allocations
CREATE POLICY payment_allocations_officer_devadmin ON payment_allocations
  FOR ALL TO authenticated
  USING (get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY payment_allocations_student_read ON payment_allocations
  FOR SELECT TO authenticated
  USING (
    payment_id IN (
      SELECT id FROM payments
      WHERE student_id = (SELECT student_id FROM users WHERE id = auth.uid())
    )
  );

-- F. event_participants
CREATE POLICY event_participants_officer_devadmin ON event_participants
  FOR ALL TO authenticated
  USING (get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY event_participants_student_read ON event_participants
  FOR SELECT TO authenticated
  USING (
    student_id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

-- ============================================================================
-- 6. TRUSTED TRANSACTIONAL SERVER-SIDE RPC FUNCTIONS
-- ============================================================================

-- Function 1: Server-side Bulk Absence Fine Assessment
CREATE OR REPLACE FUNCTION assess_bulk_absence_fines(
  p_occurrence_id UUID,
  p_rule_id UUID,
  p_student_ids UUID[],
  p_amount_centavos BIGINT,
  p_due_date DATE DEFAULT NULL,
  p_title TEXT DEFAULT 'Event Absence Fine',
  p_batch_id UUID DEFAULT gen_random_uuid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_occ RECORD;
  v_rule RECORD;
  v_stu_id UUID;
  v_created_count INT := 0;
  v_skipped_count INT := 0;
  v_invalid_count INT := 0;
  v_is_required INT;
  v_is_excused INT;
  v_has_attended INT;
  v_already_fined INT;
BEGIN
  -- 1. Validate Caller Role
  v_role := get_current_user_role();
  IF v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not authorized to assess bulk fines.';
  END IF;

  -- 2. Validate Occurrence and Finalization State
  SELECT * INTO v_occ FROM event_occurrences WHERE id = p_occurrence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event occurrence not found.';
  END IF;

  IF v_occ.status <> 'CLOSED' THEN
    RAISE EXCEPTION 'Cannot assess absence fines while attendance session is still open or scheduled.';
  END IF;

  -- 3. Validate Rule
  SELECT * INTO v_rule FROM obligation_rules WHERE id = p_rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Obligation rule not found.';
  END IF;

  IF p_amount_centavos <= 0 THEN
    RAISE EXCEPTION 'Fine amount must be greater than zero.';
  END IF;

  -- 4. Process Each Student Transactionally
  FOREACH v_stu_id IN ARRAY p_student_ids
  LOOP
    -- Verify student is in required roster
    SELECT attendance_required, excused INTO v_is_required, v_is_excused
    FROM event_participants
    WHERE occurrence_id = p_occurrence_id AND student_id = v_stu_id;

    IF NOT FOUND OR v_is_required <> 1 OR v_is_excused <> 0 THEN
      v_invalid_count := v_invalid_count + 1;
      CONTINUE;
    END IF;

    -- Verify student has NO valid attendance
    SELECT COUNT(*) INTO v_has_attended
    FROM attendance_records
    WHERE occurrence_id = p_occurrence_id
      AND student_id = v_stu_id
      AND status IN ('PRESENT', 'LATE', 'EXCUSED');

    IF v_has_attended > 0 THEN
      v_invalid_count := v_invalid_count + 1;
      CONTINUE;
    END IF;

    -- Check if already fined
    SELECT COUNT(*) INTO v_already_fined
    FROM student_obligations
    WHERE student_id = v_stu_id
      AND rule_id = p_rule_id
      AND related_occurrence_id = p_occurrence_id
      AND status = 'ACTIVE';

    IF v_already_fined > 0 THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    -- Insert fine obligation
    INSERT INTO student_obligations (
      student_id,
      semester_id,
      rule_id,
      related_event_id,
      related_occurrence_id,
      title,
      type,
      amount_centavos,
      status,
      due_date,
      issued_by_user_id,
      batch_id,
      issued_at,
      updated_at
    ) VALUES (
      v_stu_id,
      v_rule.semester_id,
      p_rule_id,
      v_occ.event_id,
      p_occurrence_id,
      coalesce(p_title, v_rule.name),
      'FINE',
      p_amount_centavos,
      'ACTIVE',
      p_due_date,
      auth.uid(),
      p_batch_id,
      now(),
      now()
    );

    v_created_count := v_created_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'created_count', v_created_count,
    'skipped_count', v_skipped_count,
    'invalid_count', v_invalid_count
  );
END;
$$;

-- Function 2: Server-side Direct Payment Recording
CREATE OR REPLACE FUNCTION record_obligation_payment(
  p_student_id UUID,
  p_semester_id UUID,
  p_reference_number TEXT,
  p_idempotency_key TEXT,
  p_amount_centavos BIGINT,
  p_source TEXT,
  p_channel TEXT,
  p_allocations JSONB,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_existing_payment RECORD;
  v_new_payment_id UUID;
  v_alloc_total BIGINT := 0;
  v_alloc JSONB;
  v_ob_id UUID;
  v_alloc_amount BIGINT;
  v_ob RECORD;
  v_paid_centavos BIGINT;
  v_balance BIGINT;
BEGIN
  -- 1. Validate Caller Role
  v_role := get_current_user_role();
  IF v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not authorized to record payments.';
  END IF;

  -- 2. Idempotency Check
  SELECT * INTO v_existing_payment FROM payments WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'payment_id', v_existing_payment.id,
      'reference_number', v_existing_payment.reference_number,
      'idempotent_replay', true
    );
  END IF;

  IF p_amount_centavos <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  IF p_source NOT IN ('CASH_RECORDED', 'MANUAL_TRANSFER_RECORD') THEN
    RAISE EXCEPTION 'Invalid payment source. Only CASH_RECORDED and MANUAL_TRANSFER_RECORD are permitted.';
  END IF;

  -- 3. Validate Allocations
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    v_alloc_amount := (v_alloc->>'amount_centavos')::BIGINT;
    v_ob_id := (v_alloc->>'obligation_id')::UUID;

    IF v_alloc_amount <= 0 THEN
      RAISE EXCEPTION 'Allocation amounts must be strictly positive.';
    END IF;

    v_alloc_total := v_alloc_total + v_alloc_amount;

    -- Validate obligation exists and student matches
    SELECT * INTO v_ob FROM student_obligations WHERE id = v_ob_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Obligation % not found or not active.', v_ob_id;
    END IF;

    IF v_ob.student_id <> p_student_id THEN
      RAISE EXCEPTION 'Obligation % belongs to a different student.', v_ob_id;
    END IF;

    -- Calculate current balance
    SELECT coalesce(SUM(amount_centavos), 0) INTO v_paid_centavos
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.obligation_id = v_ob_id AND p.status = 'POSTED';

    v_balance := v_ob.amount_centavos - v_paid_centavos;
    IF v_alloc_amount > v_balance THEN
      RAISE EXCEPTION 'Allocation amount % exceeds remaining obligation balance %.', v_alloc_amount, v_balance;
    END IF;
  END LOOP;

  IF v_alloc_total <> p_amount_centavos THEN
    RAISE EXCEPTION 'Total allocations (%) does not match payment amount (%).', v_alloc_total, p_amount_centavos;
  END IF;

  -- 4. Insert Payment Record
  INSERT INTO payments (
    student_id,
    semester_id,
    reference_number,
    idempotency_key,
    amount_centavos,
    source,
    channel,
    status,
    processed_by_user_id,
    notes,
    processed_at
  ) VALUES (
    p_student_id,
    p_semester_id,
    p_reference_number,
    p_idempotency_key,
    p_amount_centavos,
    p_source,
    coalesce(p_channel, 'MANUAL'),
    'POSTED',
    auth.uid(),
    p_notes,
    now()
  )
  RETURNING id INTO v_new_payment_id;

  -- 5. Insert Payment Allocations
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    INSERT INTO payment_allocations (
      payment_id,
      obligation_id,
      amount_centavos
    ) VALUES (
      v_new_payment_id,
      (v_alloc->>'obligation_id')::UUID,
      (v_alloc->>'amount_centavos')::BIGINT
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_new_payment_id,
    'reference_number', p_reference_number,
    'idempotent_replay', false
  );
END;
$$;

