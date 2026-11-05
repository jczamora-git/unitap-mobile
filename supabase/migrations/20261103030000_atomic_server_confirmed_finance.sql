-- ============================================================================
-- UniTap 2.0: Atomic Server-Confirmed Finance Transactions & Authorization
-- Migration: 20261103030000_atomic_server_confirmed_finance.sql
-- TARGET ENGINE: Supabase PostgreSQL (Strictly Forward-Only)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SECURE & DEPRECATE LEGACY RPC (NON-DESTRUCTIVE: NO DROP)
-- ----------------------------------------------------------------------------
-- Re-route legacy call to canonical record_student_payment to enforce active appointment,
-- FINANCE permissions, student/semester scopes, safe positive centavos, and row-locking.
CREATE OR REPLACE FUNCTION public.record_obligation_payment(
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
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.record_student_payment(
    gen_random_uuid(),
    p_student_id,
    p_semester_id::text,
    p_reference_number,
    p_idempotency_key,
    p_amount_centavos,
    p_source,
    p_channel,
    p_allocations,
    p_notes
  );
END;
$$;

-- Revoke execute from public and anon (prevents anonymous calling), grant only to authenticated
REVOKE ALL ON FUNCTION public.record_obligation_payment(uuid, uuid, text, text, bigint, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_obligation_payment(uuid, uuid, text, text, bigint, text, text, jsonb, text) TO authenticated;
COMMENT ON FUNCTION public.record_obligation_payment(uuid, uuid, text, text, bigint, text, text, jsonb, text) IS 'DEPRECATED SHIM: Delegates to public.record_student_payment with full appointment and scope authorization.';

-- ----------------------------------------------------------------------------
-- 2. CANONICAL RPC: record_student_payment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_student_payment(
  p_payment_id UUID,
  p_student_id UUID,
  p_semester_id TEXT,
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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_existing RECORD;
  v_student RECORD;
  v_semester RECORD;
  v_ob RECORD;
  v_alloc_total BIGINT := 0;
  v_paid BIGINT;
  v_remaining BIGINT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_alloc_elem RECORD;
  v_alloc_rec RECORD;
  v_cleaned_source TEXT;
  v_has_valid_appointment BOOLEAN := FALSE;
  v_appt RECORD;
  v_perm_granted BOOLEAN;
  v_scope_valid BOOLEAN;
  v_user_rec RECORD;
BEGIN
  -- 1. Fail-closed authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to post payments.';
  END IF;

  -- Verify active user account status (Fail-closed on suspended/disabled)
  SELECT * INTO v_user_rec FROM public.users WHERE id = v_user_id;
  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Caller account is suspended or inactive.';
  END IF;

  -- 2. Fail-closed role authorization
  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Caller has no active roles.';
  END IF;

  IF v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not authorized to record payments.';
  END IF;

  -- 3. Active Officer Appointment & Scope Verification (Multi-Appointment Safe)
  IF v_role = 'OFFICER' THEN
    FOR v_appt IN
      SELECT *
      FROM public.officer_appointments
      WHERE user_id = v_user_id
        AND status = 'ACTIVE'
        AND suspended_at IS NULL
        AND revoked_at IS NULL
        AND appointment_start <= v_now
        AND appointment_end >= v_now
      ORDER BY appointment_end DESC
    LOOP
      v_perm_granted := FALSE;
      v_scope_valid := FALSE;

      -- Check FINANCE / payments.record permission
      -- Preset check: FINANCE and FULL grant payments.record by default
      IF v_appt.permission_preset IN ('FINANCE', 'FULL') THEN
        v_perm_granted := TRUE;
      END IF;

      -- Inspect custom_permissions JSONB (array or object, respecting explicit false)
      IF v_appt.custom_permissions IS NOT NULL THEN
        IF jsonb_typeof(v_appt.custom_permissions) = 'array' THEN
          IF v_appt.custom_permissions ? 'payments.record'
             OR v_appt.custom_permissions ? 'FINANCE'
             OR v_appt.custom_permissions ? 'finance' THEN
            v_perm_granted := TRUE;
          END IF;
        ELSIF jsonb_typeof(v_appt.custom_permissions) = 'object' THEN
          IF (v_appt.custom_permissions->>'payments.record')::boolean IS TRUE
             OR (v_appt.custom_permissions->>'FINANCE')::boolean IS TRUE
             OR (v_appt.custom_permissions->>'finance')::boolean IS TRUE THEN
            v_perm_granted := TRUE;
          ELSIF (v_appt.custom_permissions->>'payments.record')::boolean IS FALSE
             OR (v_appt.custom_permissions->>'FINANCE')::boolean IS FALSE
             OR (v_appt.custom_permissions->>'finance')::boolean IS FALSE THEN
            v_perm_granted := FALSE;
          END IF;
        END IF;
      END IF;

      -- Check Scope against student enrollment
      IF v_appt.scope_type = 'ORGANIZATION' THEN
        v_scope_valid := TRUE;
      ELSIF v_appt.scope_type = 'PROGRAM' THEN
        IF v_appt.scope_id IS NOT NULL THEN
          IF EXISTS (
            SELECT 1 FROM public.student_enrollments se
            WHERE se.student_id = p_student_id
              AND se.semester_id = p_semester_id
              AND se.program_id = v_appt.scope_id::text
          ) THEN
            v_scope_valid := TRUE;
          END IF;
        END IF;
      ELSIF v_appt.scope_type = 'SECTION' THEN
        IF v_appt.scope_id IS NOT NULL THEN
          IF EXISTS (
            SELECT 1 FROM public.student_enrollments se
            WHERE se.student_id = p_student_id
              AND se.semester_id = p_semester_id
              AND se.section_id::text = v_appt.scope_id::text
          ) THEN
            v_scope_valid := TRUE;
          END IF;
        END IF;
      END IF;

      IF v_perm_granted AND v_scope_valid THEN
        v_has_valid_appointment := TRUE;
        EXIT; -- Found a qualifying appointment
      END IF;
    END LOOP;

    IF NOT v_has_valid_appointment THEN
      RAISE EXCEPTION 'Unauthorized: Officer lacks an active appointment with FINANCE permission and valid scope for this student and semester.';
    END IF;
  END IF;

  -- 4. Idempotency Check with COMPLETE Request & Allocation Verification
  SELECT * INTO v_existing FROM public.payments WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- Verify payload header identity matches existing record
    IF v_existing.student_id <> p_student_id
       OR v_existing.amount_centavos <> p_amount_centavos
       OR v_existing.semester_id <> p_semester_id THEN
      RAISE EXCEPTION 'Idempotency conflict: Idempotency key % was already used for a different payment header.', p_idempotency_key;
    END IF;

    -- Verify complete allocations match previously recorded payment
    IF EXISTS (
      WITH req_alloc AS (
        SELECT 
          (elem->>'obligation_id')::uuid AS obligation_id,
          SUM((elem->>'amount_centavos')::bigint) AS amount_centavos
        FROM jsonb_array_elements(p_allocations) elem
        GROUP BY (elem->>'obligation_id')::uuid
      ),
      exist_alloc AS (
        SELECT obligation_id, amount_centavos
        FROM public.payment_allocations
        WHERE payment_id = v_existing.id
      )
      SELECT 1 FROM (
        SELECT obligation_id, amount_centavos FROM req_alloc
        EXCEPT
        SELECT obligation_id, amount_centavos FROM exist_alloc
      ) d1
      UNION ALL
      SELECT 1 FROM (
        SELECT obligation_id, amount_centavos FROM exist_alloc
        EXCEPT
        SELECT obligation_id, amount_centavos FROM req_alloc
      ) d2
    ) THEN
      RAISE EXCEPTION 'Idempotency conflict: Allocations do not match previously recorded payment for idempotency key %.', p_idempotency_key;
    END IF;

    -- Explicitly handle retries against REVERSED payments without returning a misleading posted receipt
    IF v_existing.status = 'REVERSED' THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'PAYMENT_PREVIOUSLY_REVERSED',
        'payment_id', v_existing.id,
        'reference_number', v_existing.reference_number,
        'amount_centavos', v_existing.amount_centavos,
        'reversed_at', v_existing.reversed_at,
        'reversal_reason', v_existing.reversal_reason,
        'error', 'Payment associated with this idempotency key was previously reversed.'
      );
    END IF;

    IF v_existing.status <> 'POSTED' THEN
      RAISE EXCEPTION 'Idempotency conflict: Existing payment has invalid status %.', v_existing.status;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'ALREADY_RECORDED',
      'payment_id', v_existing.id,
      'reference_number', v_existing.reference_number,
      'amount_centavos', v_existing.amount_centavos,
      'processed_at', v_existing.processed_at
    );
  END IF;

  -- Ensure payment_id does not collide with existing ID with different idempotency key
  IF EXISTS (SELECT 1 FROM public.payments WHERE id = p_payment_id) THEN
    RAISE EXCEPTION 'Payment ID % already exists with a different idempotency key.', p_payment_id;
  END IF;

  -- Ensure reference_number is unique
  IF EXISTS (SELECT 1 FROM public.payments WHERE reference_number = p_reference_number) THEN
    RAISE EXCEPTION 'Payment reference number % is already in use.', p_reference_number;
  END IF;

  -- 5. Strict Parameter Validation
  IF p_amount_centavos <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero centavos.';
  END IF;

  IF p_allocations IS NULL OR jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'Payment allocations must be a non-empty array.';
  END IF;

  -- Validate student exists and is active
  SELECT * INTO v_student FROM public.students WHERE id = p_student_id AND status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student % not found or not active.', p_student_id;
  END IF;

  -- Validate semester exists
  SELECT * INTO v_semester FROM public.semesters WHERE id = p_semester_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Semester % not found.', p_semester_id;
  END IF;

  -- Validate and normalize payment source (reject retired SIMULATED_WALLET or unknown)
  IF p_source IN ('CASH', 'CASH_RECORDED') THEN
    v_cleaned_source := 'CASH_RECORDED';
  ELSIF p_source IN ('MANUAL_TRANSFER', 'MANUAL_TRANSFER_RECORD') THEN
    v_cleaned_source := 'MANUAL_TRANSFER_RECORD';
  ELSE
    RAISE EXCEPTION 'Unsupported payment source %.', p_source;
  END IF;

  -- 6. Validate Individual Allocation Elements
  FOR v_alloc_elem IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    IF (v_alloc_elem.value->>'obligation_id') IS NULL
       OR (v_alloc_elem.value->>'obligation_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Invalid obligation ID in payment allocations.';
    END IF;

    IF (v_alloc_elem.value->>'amount_centavos') IS NULL
       OR (v_alloc_elem.value->>'amount_centavos')::bigint <= 0 THEN
      RAISE EXCEPTION 'Each allocation amount must be a positive integer in centavos.';
    END IF;
  END LOOP;

  -- Total allocations match payment amount
  SELECT COALESCE(SUM((elem->>'amount_centavos')::bigint), 0) INTO v_alloc_total
  FROM jsonb_array_elements(p_allocations) elem;

  IF v_alloc_total <> p_amount_centavos THEN
    RAISE EXCEPTION 'Total allocations (% centavos) does not match payment amount (% centavos).', v_alloc_total, p_amount_centavos;
  END IF;

  -- 7. Deterministic Row-Level Locking (Ascending UUID Order)
  PERFORM 1
  FROM public.student_obligations so
  WHERE so.id IN (
    SELECT (elem->>'obligation_id')::uuid
    FROM jsonb_array_elements(p_allocations) elem
  )
  ORDER BY so.id ASC
  FOR UPDATE;

  -- 8. Validate Allocations against Live Server Balances (Active & Non-Void obligations)
  FOR v_alloc_rec IN
    SELECT 
      (elem->>'obligation_id')::uuid AS obligation_id,
      SUM((elem->>'amount_centavos')::bigint) AS alloc_centavos
    FROM jsonb_array_elements(p_allocations) elem
    GROUP BY (elem->>'obligation_id')::uuid
    ORDER BY (elem->>'obligation_id')::uuid ASC
  LOOP
    SELECT * INTO v_ob
    FROM public.student_obligations
    WHERE id = v_alloc_rec.obligation_id AND status <> 'VOID';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Obligation % is void, inactive, or does not exist.', v_alloc_rec.obligation_id;
    END IF;

    IF v_ob.student_id <> p_student_id THEN
      RAISE EXCEPTION 'Obligation % belongs to a different student.', v_alloc_rec.obligation_id;
    END IF;

    IF v_ob.semester_id <> p_semester_id THEN
      RAISE EXCEPTION 'Obligation % does not belong to semester %.', v_alloc_rec.obligation_id, p_semester_id;
    END IF;

    -- Calculate live server paid centavos using unambiguous table qualification
    SELECT COALESCE(SUM(pa.amount_centavos), 0) INTO v_paid
    FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    WHERE pa.obligation_id = v_alloc_rec.obligation_id AND p.status = 'POSTED';

    v_remaining := v_ob.amount_centavos - v_paid;
    IF v_alloc_rec.alloc_centavos > v_remaining THEN
      RAISE EXCEPTION 'Allocation of % centavos exceeds remaining balance of % centavos for obligation %.',
        v_alloc_rec.alloc_centavos, v_remaining, v_alloc_rec.obligation_id;
    END IF;
  END LOOP;

  -- 9. Insert Payment Record (Wrapped with Unique Violation Exception for Concurrency Safety)
  BEGIN
    INSERT INTO public.payments (
      id, student_id, semester_id, reference_number, idempotency_key,
      amount_centavos, source, channel, status, processed_by_user_id,
      notes, processed_at, updated_at
    ) VALUES (
      p_payment_id, p_student_id, p_semester_id, p_reference_number, p_idempotency_key,
      p_amount_centavos, v_cleaned_source, COALESCE(p_channel, 'MANUAL'), 'POSTED', v_user_id,
      p_notes, v_now, v_now
    );
  EXCEPTION WHEN unique_violation THEN
    -- Check if concurrent insert with identical idempotency key succeeded
    SELECT * INTO v_existing FROM public.payments WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.student_id <> p_student_id
         OR v_existing.amount_centavos <> p_amount_centavos
         OR v_existing.semester_id <> p_semester_id THEN
        RAISE EXCEPTION 'Idempotency conflict: Concurrent insertion for key % used different payment header.', p_idempotency_key;
      END IF;

      -- Check allocations on concurrent unique violation path
      IF EXISTS (
        WITH req_alloc AS (
          SELECT 
            (elem->>'obligation_id')::uuid AS obligation_id,
            SUM((elem->>'amount_centavos')::bigint) AS amount_centavos
          FROM jsonb_array_elements(p_allocations) elem
          GROUP BY (elem->>'obligation_id')::uuid
        ),
        exist_alloc AS (
          SELECT obligation_id, amount_centavos
          FROM public.payment_allocations
          WHERE payment_id = v_existing.id
        )
        SELECT 1 FROM (
          SELECT obligation_id, amount_centavos FROM req_alloc
          EXCEPT
          SELECT obligation_id, amount_centavos FROM exist_alloc
        ) d1
        UNION ALL
        SELECT 1 FROM (
          SELECT obligation_id, amount_centavos FROM exist_alloc
          EXCEPT
          SELECT obligation_id, amount_centavos FROM req_alloc
        ) d2
      ) THEN
        RAISE EXCEPTION 'Idempotency conflict: Concurrent insertion for key % used different allocations.', p_idempotency_key;
      END IF;

      IF v_existing.status = 'REVERSED' THEN
        RETURN jsonb_build_object(
          'success', false,
          'status', 'PAYMENT_PREVIOUSLY_REVERSED',
          'payment_id', v_existing.id,
          'reference_number', v_existing.reference_number,
          'amount_centavos', v_existing.amount_centavos,
          'reversed_at', v_existing.reversed_at,
          'reversal_reason', v_existing.reversal_reason,
          'error', 'Payment associated with this idempotency key was previously reversed.'
        );
      END IF;

      RETURN jsonb_build_object(
        'success', true,
        'status', 'ALREADY_RECORDED',
        'payment_id', v_existing.id,
        'reference_number', v_existing.reference_number,
        'amount_centavos', v_existing.amount_centavos,
        'processed_at', v_existing.processed_at
      );
    ELSE
      RAISE;
    END IF;
  END;

  -- 10. Insert Aggregated Payment Allocations (Safe Direct SQL Aggregation)
  INSERT INTO public.payment_allocations (id, payment_id, obligation_id, amount_centavos, created_at)
  SELECT 
    gen_random_uuid(),
    p_payment_id,
    (elem->>'obligation_id')::uuid,
    SUM((elem->>'amount_centavos')::bigint),
    v_now
  FROM jsonb_array_elements(p_allocations) elem
  GROUP BY (elem->>'obligation_id')::uuid;

  -- 11. Transactional Audit Log
  INSERT INTO public.audit_events (
    id, entity_type, entity_id, action, actor_user_id, occurred_at, payload_json
  ) VALUES (
    gen_random_uuid(), 'PAYMENT', p_payment_id::text, 'RECORD', v_user_id, v_now,
    jsonb_build_object(
      'amount_centavos', p_amount_centavos,
      'reference_number', p_reference_number,
      'idempotency_key', p_idempotency_key,
      'student_id', p_student_id,
      'semester_id', p_semester_id,
      'source', v_cleaned_source,
      'channel', COALESCE(p_channel, 'MANUAL')
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'CONFIRMED',
    'payment_id', p_payment_id,
    'reference_number', p_reference_number,
    'amount_centavos', p_amount_centavos,
    'processed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_student_payment(uuid, uuid, text, text, text, bigint, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_student_payment(uuid, uuid, text, text, text, bigint, text, text, jsonb, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. CANONICAL RPC: reverse_student_payment
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_student_payment(
  p_payment_id UUID,
  p_reversal_reason TEXT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_payment RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_has_valid_reversal_appt BOOLEAN := FALSE;
  v_appt RECORD;
  v_perm_granted BOOLEAN;
  v_scope_valid BOOLEAN;
  v_user_rec RECORD;
BEGIN
  -- 1. Fail-closed authentication
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reverse payments.';
  END IF;

  -- Verify active user account status (Fail-closed on suspended/disabled)
  SELECT * INTO v_user_rec FROM public.users WHERE id = v_user_id;
  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Caller account is suspended or inactive.';
  END IF;

  -- 2. Fail-closed role authorization
  SELECT role INTO v_role
  FROM public.user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RAISE EXCEPTION 'Unauthorized: Caller lacks payment reversal permissions.';
  END IF;

  -- 3. Mandatory Reversal Reason
  IF p_reversal_reason IS NULL OR length(trim(p_reversal_reason)) = 0 THEN
    RAISE EXCEPTION 'Reversal reason is mandatory.';
  END IF;

  -- 4. Deterministic Row Lock
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found.', p_payment_id;
  END IF;

  -- 5. Officer Specific Permissions & Scope Verification
  -- Payment reversal is highly sensitive: requires FULL preset or explicit payments.reverse
  IF v_role = 'OFFICER' THEN
    FOR v_appt IN
      SELECT *
      FROM public.officer_appointments
      WHERE user_id = v_user_id
        AND status = 'ACTIVE'
        AND suspended_at IS NULL
        AND revoked_at IS NULL
        AND appointment_start <= v_now
        AND appointment_end >= v_now
      ORDER BY appointment_end DESC
    LOOP
      v_perm_granted := FALSE;
      v_scope_valid := FALSE;

      -- Preset check: Only FULL includes payments.reverse (FINANCE preset does NOT)
      IF v_appt.permission_preset = 'FULL' THEN
        v_perm_granted := TRUE;
      END IF;

      -- Custom permissions check
      IF v_appt.custom_permissions IS NOT NULL THEN
        IF jsonb_typeof(v_appt.custom_permissions) = 'array' THEN
          IF v_appt.custom_permissions ? 'payments.reverse' THEN
            v_perm_granted := TRUE;
          END IF;
        ELSIF jsonb_typeof(v_appt.custom_permissions) = 'object' THEN
          IF (v_appt.custom_permissions->>'payments.reverse')::boolean IS TRUE THEN
            v_perm_granted := TRUE;
          ELSIF (v_appt.custom_permissions->>'payments.reverse')::boolean IS FALSE THEN
            v_perm_granted := FALSE;
          END IF;
        END IF;
      END IF;

      -- Scope check against payment student's enrollment
      IF v_appt.scope_type = 'ORGANIZATION' THEN
        v_scope_valid := TRUE;
      ELSIF v_appt.scope_type = 'PROGRAM' THEN
        IF v_appt.scope_id IS NOT NULL THEN
          IF EXISTS (
            SELECT 1 FROM public.student_enrollments se
            WHERE se.student_id = v_payment.student_id
              AND se.semester_id = v_payment.semester_id
              AND se.program_id = v_appt.scope_id::text
          ) THEN
            v_scope_valid := TRUE;
          END IF;
        END IF;
      ELSIF v_appt.scope_type = 'SECTION' THEN
        IF v_appt.scope_id IS NOT NULL THEN
          IF EXISTS (
            SELECT 1 FROM public.student_enrollments se
            WHERE se.student_id = v_payment.student_id
              AND se.semester_id = v_payment.semester_id
              AND se.section_id::text = v_appt.scope_id::text
          ) THEN
            v_scope_valid := TRUE;
          END IF;
        END IF;
      END IF;

      IF v_perm_granted AND v_scope_valid THEN
        v_has_valid_reversal_appt := TRUE;
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_has_valid_reversal_appt THEN
      RAISE EXCEPTION 'Unauthorized: Officer lacks an active appointment with payments.reverse permission and valid scope for this payment.';
    END IF;
  END IF;

  -- 6. Safe Reentrant Idempotency
  IF v_payment.status = 'REVERSED' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', 'ALREADY_REVERSED',
      'payment_id', p_payment_id,
      'reversed_at', v_payment.reversed_at
    );
  END IF;

  IF v_payment.status <> 'POSTED' THEN
    RAISE EXCEPTION 'Only POSTED payments can be reversed.';
  END IF;

  -- 7. Apply Reversal (Dynamically restores obligation balances through ledger join)
  UPDATE public.payments
  SET status = 'REVERSED',
      reversed_at = v_now,
      reversed_by_user_id = v_user_id,
      reversal_reason = trim(p_reversal_reason),
      updated_at = v_now
  WHERE id = p_payment_id;

  -- 8. Transactional Audit Log
  INSERT INTO public.audit_events (
    id, entity_type, entity_id, action, actor_user_id, occurred_at, payload_json
  ) VALUES (
    gen_random_uuid(), 'PAYMENT', p_payment_id::text, 'REVERSE', v_user_id, v_now,
    jsonb_build_object(
      'reason', trim(p_reversal_reason),
      'previous_status', 'POSTED',
      'amount_centavos', v_payment.amount_centavos,
      'reference_number', v_payment.reference_number,
      'student_id', v_payment.student_id,
      'semester_id', v_payment.semester_id,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'REVERSED',
    'payment_id', p_payment_id,
    'reversed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_student_payment(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_student_payment(uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. HARDEN sync_push_batch (PRESERVES ALL ORIGINAL BRANCHES & ADDS FINANCE SECURITY)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_push_batch(p_operations jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Payment unwrapping variables
  v_pay_obj JSONB;
  v_alloc_arr JSONB;
  v_pay_id UUID;
  v_now TIMESTAMPTZ := clock_timestamp();

  -- Scoped officer authorization helper variables for obligation assessment
  v_can_assess_ob BOOLEAN;
  v_can_manage_rules BOOLEAN;
  v_scope_ob_valid BOOLEAN;
  v_ob_student_id UUID;
  v_ob_semester_id TEXT;
  v_ob_amount BIGINT;
  v_target_ob RECORD;
  v_ob_paid BIGINT;
  v_target_rule RECORD;
  v_rule_perm BOOLEAN;
  v_rule_scope BOOLEAN;
  v_rule_semester TEXT;
  v_ob_perm BOOLEAN;
  v_ob_scope BOOLEAN;

  -- Non-finance authorization helpers
  v_nonfin_auth BOOLEAN;
  v_nonfin_perm BOOLEAN;
  v_nonfin_scope BOOLEAN;
  v_target_card RECORD;
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
    IF NOT EXISTS (
      SELECT 1 FROM public.officer_appointments
      WHERE user_id = v_user_id
        AND status = 'ACTIVE'
        AND suspended_at IS NULL
        AND revoked_at IS NULL
        AND appointment_start <= v_now
        AND appointment_end >= v_now
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Officer appointment is inactive, suspended, or expired.';
    END IF;
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
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            IF v_officer_appt.permission_preset IN ('ATTENDANCE', 'FULL') THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'attendance.scan'
                   OR v_officer_appt.custom_permissions ? 'ATTENDANCE' THEN
                  v_nonfin_auth := TRUE;
                  EXIT;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'attendance.scan')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'ATTENDANCE')::boolean IS TRUE THEN
                  v_nonfin_auth := TRUE;
                  EXIT;
                END IF;
              END IF;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission to record attendance attempts.';
        END IF;

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
          coalesce((v_payload->>'attempted_at')::timestamptz, v_now)
        ) ON CONFLICT (id) DO NOTHING;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 4. STUDENT MASTER
      ELSIF v_entity_type = 'STUDENT' THEN
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            v_nonfin_perm := FALSE;
            v_nonfin_scope := FALSE;

            -- Preset or custom permission check
            IF v_officer_appt.permission_preset = 'FULL' THEN
              v_nonfin_perm := TRUE;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'students.import'
                   OR v_officer_appt.custom_permissions ? 'students.create'
                   OR v_officer_appt.custom_permissions ? 'students.edit'
                   OR v_officer_appt.custom_permissions ? 'students.manage' THEN
                  v_nonfin_perm := TRUE;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'students.import')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'students.create')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'students.edit')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'students.manage')::boolean IS TRUE THEN
                  v_nonfin_perm := TRUE;
                ELSIF (v_officer_appt.custom_permissions->>'students.import')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'students.create')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'students.edit')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'students.manage')::boolean IS FALSE THEN
                  v_nonfin_perm := FALSE;
                END IF;
              END IF;
            END IF;

            -- Scope check
            IF v_officer_appt.scope_type = 'ORGANIZATION' THEN
              v_nonfin_scope := TRUE;
            ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
              IF v_operation = 'UPDATE' AND EXISTS (
                SELECT 1 FROM public.student_enrollments se
                WHERE se.student_id = v_entity_id::uuid AND se.program_id = v_officer_appt.scope_id::text
              ) THEN
                v_nonfin_scope := TRUE;
              END IF;
            ELSIF v_officer_appt.scope_type = 'SECTION' AND v_officer_appt.scope_id IS NOT NULL THEN
              IF v_operation = 'UPDATE' AND EXISTS (
                SELECT 1 FROM public.student_enrollments se
                WHERE se.student_id = v_entity_id::uuid AND se.section_id::text = v_officer_appt.scope_id::text
              ) THEN
                v_nonfin_scope := TRUE;
              END IF;
            END IF;

            IF v_nonfin_perm AND v_nonfin_scope THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission or valid scope to write student master records.';
        END IF;

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
            coalesce((v_payload->>'created_at')::timestamptz, v_now),
            v_now
          ) ON CONFLICT (id) DO UPDATE SET
            first_name = EXCLUDED.first_name,
            middle_name = EXCLUDED.middle_name,
            last_name = EXCLUDED.last_name,
            updated_at = v_now;
        ELSIF v_operation = 'UPDATE' THEN
          UPDATE public.students
          SET photo_local_uri = coalesce(v_payload->>'photo_local_uri', photo_local_uri),
              photo_storage_path = coalesce(v_payload->>'photo_storage_path', photo_storage_path),
              updated_at = v_now
          WHERE id = v_entity_id::uuid;
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 5. ENROLLMENT
      ELSIF v_entity_type = 'ENROLLMENT' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            v_nonfin_perm := FALSE;
            v_nonfin_scope := FALSE;

            IF v_officer_appt.permission_preset = 'FULL' THEN
              v_nonfin_perm := TRUE;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'students.import'
                   OR v_officer_appt.custom_permissions ? 'students.manage'
                   OR v_officer_appt.custom_permissions ? 'enrollments.manage' THEN
                  v_nonfin_perm := TRUE;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'students.import')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'students.manage')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'enrollments.manage')::boolean IS TRUE THEN
                  v_nonfin_perm := TRUE;
                ELSIF (v_officer_appt.custom_permissions->>'students.import')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'students.manage')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'enrollments.manage')::boolean IS FALSE THEN
                  v_nonfin_perm := FALSE;
                END IF;
              END IF;
            END IF;

            -- Scope check: program, section, semester
            IF v_officer_appt.semester_id IS NULL OR v_officer_appt.semester_id = v_payload->>'semester_id' THEN
              IF v_officer_appt.scope_type = 'ORGANIZATION' THEN
                v_nonfin_scope := TRUE;
              ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
                IF v_payload->>'program_id' = v_officer_appt.scope_id::text THEN
                  v_nonfin_scope := TRUE;
                END IF;
              ELSIF v_officer_appt.scope_type = 'SECTION' AND v_officer_appt.scope_id IS NOT NULL THEN
                IF v_payload->>'section_id' = v_officer_appt.scope_id::text THEN
                  v_nonfin_scope := TRUE;
                END IF;
              END IF;
            END IF;

            IF v_nonfin_perm AND v_nonfin_scope THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission or valid scope to mutate student enrollment.';
        END IF;

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
          v_now
        ) ON CONFLICT (id) DO UPDATE SET
          program_id = EXCLUDED.program_id,
          year_level = EXCLUDED.year_level,
          section = EXCLUDED.section,
          section_id = EXCLUDED.section_id,
          enrollment_status = EXCLUDED.enrollment_status,
          updated_at = v_now;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 6. NFC CARD
      ELSIF v_entity_type = 'CARD' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            v_nonfin_perm := FALSE;
            v_nonfin_scope := FALSE;

            IF v_officer_appt.permission_preset IN ('FULL', 'ATTENDANCE') THEN
              v_nonfin_perm := TRUE;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'cards.manage'
                   OR v_officer_appt.custom_permissions ? 'students.cards.manage'
                   OR v_officer_appt.custom_permissions ? 'ATTENDANCE' THEN
                  v_nonfin_perm := TRUE;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'cards.manage')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'students.cards.manage')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'ATTENDANCE')::boolean IS TRUE THEN
                  v_nonfin_perm := TRUE;
                ELSIF (v_officer_appt.custom_permissions->>'cards.manage')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'students.cards.manage')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'ATTENDANCE')::boolean IS FALSE THEN
                  v_nonfin_perm := FALSE;
                END IF;
              END IF;
            END IF;

            -- Scope check: student must be in officer's scope
            IF v_officer_appt.scope_type = 'ORGANIZATION' THEN
              v_nonfin_scope := TRUE;
            ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
              IF EXISTS (
                SELECT 1 FROM public.student_enrollments se
                WHERE se.student_id = (v_payload->>'student_id')::uuid
                  AND se.program_id = v_officer_appt.scope_id::text
              ) THEN
                v_nonfin_scope := TRUE;
              END IF;
            ELSIF v_officer_appt.scope_type = 'SECTION' AND v_officer_appt.scope_id IS NOT NULL THEN
              IF EXISTS (
                SELECT 1 FROM public.student_enrollments se
                WHERE se.student_id = (v_payload->>'student_id')::uuid
                  AND se.section_id::text = v_officer_appt.scope_id::text
              ) THEN
                v_nonfin_scope := TRUE;
              END IF;
            END IF;

            IF v_nonfin_perm AND v_nonfin_scope THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission or valid scope to assign or update NFC cards.';
        END IF;

        INSERT INTO public.nfc_cards (
          id, student_id, uid_normalized, status, assigned_at,
          note, updated_at
        ) VALUES (
          v_entity_id::uuid,
          (v_payload->>'student_id')::uuid,
          v_payload->>'uid_normalized',
          coalesce(v_payload->>'status', 'ACTIVE'),
          coalesce((v_payload->>'assigned_at')::timestamptz, v_now),
          coalesce(v_payload->>'note', v_payload->>'notes'),
          v_now
        ) ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          note = EXCLUDED.note,
          updated_at = v_now;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 7. EVENT, EVENT_CATEGORY, OCCURRENCE, PARTICIPANT
      ELSIF v_entity_type = 'EVENT' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            v_nonfin_perm := FALSE;
            v_nonfin_scope := FALSE;

            IF v_officer_appt.permission_preset IN ('FULL', 'ATTENDANCE') THEN
              v_nonfin_perm := TRUE;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'events.create'
                   OR v_officer_appt.custom_permissions ? 'events.edit_assigned'
                   OR v_officer_appt.custom_permissions ? 'events.manage' THEN
                  v_nonfin_perm := TRUE;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'events.create')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'events.edit_assigned')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'events.manage')::boolean IS TRUE THEN
                  v_nonfin_perm := TRUE;
                ELSIF (v_officer_appt.custom_permissions->>'events.create')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'events.edit_assigned')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'events.manage')::boolean IS FALSE THEN
                  v_nonfin_perm := FALSE;
                END IF;
              END IF;
            END IF;

            -- Scope check: semester must match if appointment has semester_id
            IF v_officer_appt.semester_id IS NULL OR v_officer_appt.semester_id = v_payload->>'semester_id' THEN
              v_nonfin_scope := TRUE;
            END IF;

            IF v_nonfin_perm AND v_nonfin_scope THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission or valid scope to create or edit events.';
        END IF;

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
          coalesce((v_payload->>'created_at')::timestamptz, v_now),
          v_now
        ) ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          category_id = EXCLUDED.category_id,
          status = EXCLUDED.status,
          updated_at = v_now;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'EVENT_CATEGORY' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            IF v_officer_appt.permission_preset = 'FULL' THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'events.create'
                   OR v_officer_appt.custom_permissions ? 'events.manage' THEN
                  v_nonfin_auth := TRUE;
                  EXIT;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'events.create')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'events.manage')::boolean IS TRUE THEN
                  v_nonfin_auth := TRUE;
                  EXIT;
                END IF;
              END IF;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission to manage event categories.';
        END IF;

        INSERT INTO public.event_categories (id, name, description, code, status, created_at, updated_at)
        VALUES (
          v_entity_id::uuid,
          v_payload->>'name',
          v_payload->>'description',
          v_payload->>'code',
          coalesce(v_payload->>'status', 'ACTIVE'),
          coalesce((v_payload->>'created_at')::timestamptz, v_now),
          v_now
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          status = EXCLUDED.status,
          updated_at = v_now;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'OCCURRENCE' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            IF v_officer_appt.permission_preset IN ('FULL', 'ATTENDANCE') THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'events.create'
                   OR v_officer_appt.custom_permissions ? 'events.edit_assigned'
                   OR v_officer_appt.custom_permissions ? 'events.manage' THEN
                  v_nonfin_auth := TRUE;
                  EXIT;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'events.create')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'events.edit_assigned')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'events.manage')::boolean IS TRUE THEN
                  v_nonfin_auth := TRUE;
                  EXIT;
                END IF;
              END IF;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission to manage event occurrences.';
        END IF;

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
          v_now
        ) ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          status = EXCLUDED.status,
          updated_at = v_now;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'PARTICIPANT' AND v_operation = 'CREATE' THEN
        v_nonfin_auth := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_nonfin_auth := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            v_nonfin_perm := FALSE;
            v_nonfin_scope := FALSE;

            IF v_officer_appt.permission_preset IN ('FULL', 'ATTENDANCE') THEN
              v_nonfin_perm := TRUE;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'attendance.confirm'
                   OR v_officer_appt.custom_permissions ? 'attendance.absentees'
                   OR v_officer_appt.custom_permissions ? 'ATTENDANCE' THEN
                  v_nonfin_perm := TRUE;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'attendance.confirm')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'attendance.absentees')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'ATTENDANCE')::boolean IS TRUE THEN
                  v_nonfin_perm := TRUE;
                ELSIF (v_officer_appt.custom_permissions->>'attendance.confirm')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'attendance.absentees')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'ATTENDANCE')::boolean IS FALSE THEN
                  v_nonfin_perm := FALSE;
                END IF;
              END IF;
            END IF;

            -- Scope check for student
            IF v_officer_appt.scope_type = 'ORGANIZATION' THEN
              v_nonfin_scope := TRUE;
            ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
              IF EXISTS (
                SELECT 1 FROM public.student_enrollments se
                WHERE se.student_id = (v_payload->>'student_id')::uuid
                  AND se.program_id = v_officer_appt.scope_id::text
              ) THEN
                v_nonfin_scope := TRUE;
              END IF;
            ELSIF v_officer_appt.scope_type = 'SECTION' AND v_officer_appt.scope_id IS NOT NULL THEN
              IF EXISTS (
                SELECT 1 FROM public.student_enrollments se
                WHERE se.student_id = (v_payload->>'student_id')::uuid
                  AND se.section_id::text = v_officer_appt.scope_id::text
              ) THEN
                v_nonfin_scope := TRUE;
              END IF;
            END IF;

            IF v_nonfin_perm AND v_nonfin_scope THEN
              v_nonfin_auth := TRUE;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_nonfin_auth THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission or scope to register event participants.';
        END IF;

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
          v_now
        ) ON CONFLICT (id) DO NOTHING;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 8. FINANCE: OBLIGATION_RULE, OBLIGATION (Hardened with Permission & Scope Checks)
      ELSIF v_entity_type = 'OBLIGATION_RULE' AND (v_operation = 'CREATE' OR v_operation = 'UPDATE') THEN
        v_can_manage_rules := FALSE;

        -- Resolve target semester and enforce existence
        IF v_operation = 'UPDATE' THEN
          SELECT * INTO v_target_rule FROM public.obligation_rules WHERE id = v_entity_id::uuid;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Obligation rule % not found for update.', v_entity_id;
          END IF;
          IF v_payload->>'semester_id' IS NOT NULL AND v_payload->>'semester_id' <> v_target_rule.semester_id THEN
            RAISE EXCEPTION 'Cannot transfer obligation rule % to a different semester.', v_entity_id;
          END IF;
          v_rule_semester := v_target_rule.semester_id;
        ELSE
          v_rule_semester := v_payload->>'semester_id';
        END IF;

        IF v_rule_semester IS NULL OR length(trim(v_rule_semester)) = 0 THEN
          RAISE EXCEPTION 'Semester ID is required for obligation rule.';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.semesters WHERE id = v_rule_semester) THEN
          RAISE EXCEPTION 'Semester % does not exist.', v_rule_semester;
        END IF;

        IF v_role = 'DEVADMIN' THEN
          v_can_manage_rules := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            -- CRITICAL: Reset flags per appointment (NO LEAKAGE)
            v_rule_perm := FALSE;
            v_rule_scope := FALSE;

            IF v_officer_appt.permission_preset IN ('FINANCE', 'FULL') THEN
              v_rule_perm := TRUE;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'fines.templates.manage'
                   OR v_officer_appt.custom_permissions ? 'contributions.templates.manage'
                   OR v_officer_appt.custom_permissions ? 'FINANCE' THEN
                  v_rule_perm := TRUE;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'fines.templates.manage')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'contributions.templates.manage')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'FINANCE')::boolean IS TRUE THEN
                  v_rule_perm := TRUE;
                ELSIF (v_officer_appt.custom_permissions->>'fines.templates.manage')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'contributions.templates.manage')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'FINANCE')::boolean IS FALSE THEN
                  v_rule_perm := FALSE;
                END IF;
              END IF;
            END IF;

            -- Semester scope check
            IF v_officer_appt.semester_id IS NULL OR v_officer_appt.semester_id = v_rule_semester THEN
              v_rule_scope := TRUE;
            END IF;

            IF v_rule_perm AND v_rule_scope THEN
              v_can_manage_rules := TRUE;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_can_manage_rules THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks obligation rule management permissions or semester scope.';
        END IF;

        IF coalesce((v_payload->>'default_amount_centavos')::bigint, 0) < 0 THEN
          RAISE EXCEPTION 'Default amount must be non-negative.';
        END IF;

        INSERT INTO public.obligation_rules (
          id, semester_id, name, type, trigger_type, default_amount_centavos, status, created_at, updated_at
        ) VALUES (
          v_entity_id::uuid,
          v_rule_semester,
          v_payload->>'name',
          coalesce(v_payload->>'type', 'FINE'),
          coalesce(v_payload->>'trigger_type', 'MANUAL'),
          coalesce((v_payload->>'default_amount_centavos')::bigint, 0),
          coalesce(v_payload->>'status', 'ACTIVE'),
          coalesce((v_payload->>'created_at')::timestamptz, v_now),
          v_now
        ) ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          default_amount_centavos = EXCLUDED.default_amount_centavos,
          status = EXCLUDED.status,
          updated_at = v_now;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      ELSIF v_entity_type = 'OBLIGATION' THEN
        -- 1. Authoritative Server-Side Target Identification
        IF v_operation IN ('UPDATE', 'VOID') THEN
          SELECT * INTO v_target_ob FROM public.student_obligations WHERE id = v_entity_id::uuid;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'Obligation % not found for % operation.', v_entity_id, v_operation;
          END IF;

          -- Reject client forged identity
          IF v_payload->>'student_id' IS NOT NULL AND (v_payload->>'student_id')::uuid <> v_target_ob.student_id THEN
            RAISE EXCEPTION 'Target obligation student identity mismatch: cannot mutate another student obligation.';
          END IF;
          IF v_payload->>'semester_id' IS NOT NULL AND v_payload->>'semester_id' <> v_target_ob.semester_id THEN
            RAISE EXCEPTION 'Target obligation semester identity mismatch: cannot mutate another semester obligation.';
          END IF;

          v_ob_student_id := v_target_ob.student_id;
          v_ob_semester_id := v_target_ob.semester_id;
        ELSE
          v_ob_student_id := (v_payload->>'student_id')::uuid;
          v_ob_semester_id := v_payload->>'semester_id';
        END IF;

        IF v_ob_student_id IS NULL OR v_ob_semester_id IS NULL THEN
          RAISE EXCEPTION 'Student ID and Semester ID are required for obligation.';
        END IF;

        IF NOT EXISTS (SELECT 1 FROM public.semesters WHERE id = v_ob_semester_id) THEN
          RAISE EXCEPTION 'Semester % does not exist.', v_ob_semester_id;
        END IF;

        -- 2. Authorization with Multi-Appointment Leakage Prevention (Reset in loop)
        v_can_assess_ob := FALSE;
        IF v_role = 'DEVADMIN' THEN
          v_can_assess_ob := TRUE;
        ELSIF v_role = 'OFFICER' THEN
          FOR v_officer_appt IN
            SELECT * FROM public.officer_appointments
            WHERE user_id = v_user_id AND status = 'ACTIVE' AND suspended_at IS NULL AND revoked_at IS NULL
              AND appointment_start <= v_now AND appointment_end >= v_now
          LOOP
            -- CRITICAL: Reset BOTH flags per appointment iteration (NO LEAKAGE)
            v_ob_perm := FALSE;
            v_ob_scope := FALSE;

            -- Check permission
            IF v_officer_appt.permission_preset IN ('FINANCE', 'FULL') THEN
              v_ob_perm := TRUE;
            END IF;
            IF v_officer_appt.custom_permissions IS NOT NULL THEN
              IF jsonb_typeof(v_officer_appt.custom_permissions) = 'array' THEN
                IF v_officer_appt.custom_permissions ? 'fines.assess'
                   OR v_officer_appt.custom_permissions ? 'contributions.assign'
                   OR v_officer_appt.custom_permissions ? 'FINANCE' THEN
                  v_ob_perm := TRUE;
                END IF;
              ELSIF jsonb_typeof(v_officer_appt.custom_permissions) = 'object' THEN
                IF (v_officer_appt.custom_permissions->>'fines.assess')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'contributions.assign')::boolean IS TRUE
                   OR (v_officer_appt.custom_permissions->>'FINANCE')::boolean IS TRUE THEN
                  v_ob_perm := TRUE;
                ELSIF (v_officer_appt.custom_permissions->>'fines.assess')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'contributions.assign')::boolean IS FALSE
                   OR (v_officer_appt.custom_permissions->>'FINANCE')::boolean IS FALSE THEN
                  v_ob_perm := FALSE;
                END IF;
              END IF;
            END IF;

            -- Check Scope against student's enrollment in target semester
            IF v_officer_appt.semester_id IS NULL OR v_officer_appt.semester_id = v_ob_semester_id THEN
              IF v_officer_appt.scope_type = 'ORGANIZATION' THEN
                v_ob_scope := TRUE;
              ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
                IF EXISTS (
                  SELECT 1 FROM public.student_enrollments se
                  WHERE se.student_id = v_ob_student_id
                    AND se.semester_id = v_ob_semester_id
                    AND se.program_id = v_officer_appt.scope_id::text
                ) THEN
                  v_ob_scope := TRUE;
                END IF;
              ELSIF v_officer_appt.scope_type = 'SECTION' AND v_officer_appt.scope_id IS NOT NULL THEN
                IF EXISTS (
                  SELECT 1 FROM public.student_enrollments se
                  WHERE se.student_id = v_ob_student_id
                    AND se.semester_id = v_ob_semester_id
                    AND se.section_id::text = v_officer_appt.scope_id::text
                ) THEN
                  v_ob_scope := TRUE;
                END IF;
              END IF;
            END IF;

            -- BOTH must be true in THIS appointment
            IF v_ob_perm AND v_ob_scope THEN
              v_can_assess_ob := TRUE;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_can_assess_ob THEN
          RAISE EXCEPTION 'Unauthorized: Caller lacks permission or valid scope to assess or mutate this obligation.';
        END IF;

        -- 3. Execution & Amount/Status Integrity
        IF v_operation = 'VOID' THEN
          SELECT coalesce(SUM(pa.amount_centavos), 0) INTO v_ob_paid
          FROM public.payment_allocations pa
          JOIN public.payments p ON p.id = pa.payment_id
          WHERE pa.obligation_id = v_target_ob.id AND p.status = 'POSTED';

          IF v_ob_paid > 0 THEN
            RAISE EXCEPTION 'Cannot void obligation % with posted payments (% centavos). Reverse payments first.', v_target_ob.id, v_ob_paid;
          END IF;

          UPDATE public.student_obligations
          SET status = 'VOID', updated_at = v_now
          WHERE id = v_entity_id::uuid;

        ELSIF v_operation = 'UPDATE' THEN
          v_ob_amount := coalesce((v_payload->>'amount_centavos')::bigint, (v_payload->>'original_amount_centavos')::bigint, v_target_ob.amount_centavos);
          IF v_ob_amount <= 0 THEN
            RAISE EXCEPTION 'Obligation amount must be greater than zero centavos.';
          END IF;

          SELECT coalesce(SUM(pa.amount_centavos), 0) INTO v_ob_paid
          FROM public.payment_allocations pa
          JOIN public.payments p ON p.id = pa.payment_id
          WHERE pa.obligation_id = v_target_ob.id AND p.status = 'POSTED';

          IF v_ob_amount < v_ob_paid THEN
            RAISE EXCEPTION 'Cannot reduce obligation amount to % centavos below already posted payments (% centavos).', v_ob_amount, v_ob_paid;
          END IF;

          UPDATE public.student_obligations
          SET amount_centavos = v_ob_amount,
              status = CASE WHEN v_payload->>'status' = 'VOID' THEN 'VOID' ELSE 'ACTIVE' END,
              title = coalesce(v_payload->>'title', title),
              due_date = CASE WHEN v_payload->>'due_date' IS NOT NULL THEN (v_payload->>'due_date')::date ELSE due_date END,
              updated_at = v_now
          WHERE id = v_entity_id::uuid;

        ELSIF v_operation = 'CREATE' THEN
          v_ob_amount := coalesce((v_payload->>'amount_centavos')::bigint, (v_payload->>'original_amount_centavos')::bigint, 0);
          IF v_ob_amount <= 0 THEN
            RAISE EXCEPTION 'Obligation amount must be greater than zero centavos.';
          END IF;

          INSERT INTO public.student_obligations (
            id, student_id, rule_id, semester_id, title, type,
            amount_centavos, status, due_date, issued_at, updated_at
          ) VALUES (
            v_entity_id::uuid,
            v_ob_student_id,
            CASE WHEN v_payload->>'rule_id' IS NOT NULL THEN (v_payload->>'rule_id')::uuid ELSE NULL END,
            v_ob_semester_id,
            coalesce(v_payload->>'title', 'Student Obligation'),
            coalesce(v_payload->>'type', 'FINE'),
            v_ob_amount,
            CASE WHEN v_payload->>'status' = 'VOID' THEN 'VOID' ELSE 'ACTIVE' END,
            CASE WHEN v_payload->>'due_date' IS NOT NULL THEN (v_payload->>'due_date')::date ELSE NULL END,
            coalesce((v_payload->>'issued_at')::timestamptz, v_now),
            v_now
          ) ON CONFLICT (id) DO UPDATE SET
            amount_centavos = EXCLUDED.amount_centavos,
            status = EXCLUDED.status,
            updated_at = v_now;
        END IF;

        v_applied := v_applied + 1;
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED');
        CONTINUE;

      -- 9. FINANCE: PAYMENT & PAYMENT_ALLOCATIONS (Authoritative Delegation to Canonical Atomic RPCs)
      ELSIF v_entity_type = 'PAYMENT' THEN
        IF v_payload ? 'payment' THEN
          v_pay_obj := v_payload->'payment';
          v_alloc_arr := v_payload->'allocations';
        ELSE
          v_pay_obj := v_payload;
          v_alloc_arr := v_payload->'allocations';
        END IF;

        v_pay_id := coalesce(v_pay_obj->>'id', v_entity_id)::uuid;

        -- CASE A: Payment Reversal (Routes to canonical reverse_student_payment)
        IF v_operation = 'UPDATE' OR (v_pay_obj->>'status' = 'REVERSED') THEN
          v_scan_res := public.reverse_student_payment(
            v_pay_id,
            coalesce(v_pay_obj->>'reversal_reason', 'Reversed by officer via batch push'),
            coalesce(v_pay_obj->>'idempotency_key', v_outbox_id)
          );

          IF (v_scan_res->>'status') IN ('REVERSED', 'ALREADY_REVERSED') THEN
            v_applied := v_applied + 1;
            v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED', 'reversal_result', v_scan_res);
          ELSE
            v_failed := v_failed + 1;
            v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', coalesce(v_scan_res->>'error', v_scan_res->>'message'));
          END IF;
          CONTINUE;
        END IF;

        -- CASE B: Payment Creation (Routes to canonical record_student_payment)
        v_scan_res := public.record_student_payment(
          v_pay_id,
          (v_pay_obj->>'student_id')::uuid,
          v_pay_obj->>'semester_id',
          coalesce(v_pay_obj->>'reference_number', v_pay_obj->>'receipt_number', gen_random_uuid()::text),
          coalesce(v_pay_obj->>'idempotency_key', v_outbox_id),
          coalesce((v_pay_obj->>'amount_centavos')::bigint, (v_pay_obj->>'total_amount_centavos')::bigint, 0),
          coalesce(v_pay_obj->>'source', 'CASH_RECORDED'),
          coalesce(v_pay_obj->>'channel', 'MANUAL'),
          coalesce(v_alloc_arr, '[]'::jsonb),
          v_pay_obj->>'notes'
        );

        IF (v_scan_res->>'status') IN ('CONFIRMED', 'ALREADY_RECORDED') THEN
          v_applied := v_applied + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFIRMED', 'payment_result', v_scan_res);
        ELSE
          v_failed := v_failed + 1;
          v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', coalesce(v_scan_res->>'error', v_scan_res->>'message'));
        END IF;
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
            coalesce((v_payload->>'created_at')::timestamptz, v_now),
            v_now
          ) ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            status = EXCLUDED.status,
            updated_at = v_now;
        ELSIF v_entity_type = 'SEMESTER' THEN
          INSERT INTO public.semesters (id, academic_year_id, term, starts_on, ends_on, status, created_at, updated_at)
          VALUES (
            v_entity_id,
            v_payload->>'academic_year_id',
            v_payload->>'term',
            (v_payload->>'starts_on')::date,
            (v_payload->>'ends_on')::date,
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, v_now),
            v_now
          ) ON CONFLICT (id) DO UPDATE SET
            term = EXCLUDED.term,
            status = EXCLUDED.status,
            updated_at = v_now;
        ELSIF v_entity_type = 'PROGRAM' THEN
          INSERT INTO public.programs (id, code, name, status, created_at, updated_at)
          VALUES (
            v_entity_id,
            v_payload->>'code',
            v_payload->>'name',
            coalesce(v_payload->>'status', 'ACTIVE'),
            coalesce((v_payload->>'created_at')::timestamptz, v_now),
            v_now
          ) ON CONFLICT (id) DO UPDATE SET
            code = EXCLUDED.code,
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            updated_at = v_now;
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
      -- Concurrency collision, balance exhaustion or idempotency conflict -> route to sync_conflicts
      IF SQLERRM LIKE '%exceeds remaining%' OR SQLERRM LIKE '%Idempotency conflict%' THEN
        INSERT INTO public.sync_conflicts (
          device_id, entity_type, entity_id, conflict_type, client_payload, server_payload
        ) VALUES (
          coalesce(v_op->>'device_id', 'outbox_push'), v_entity_type, v_entity_id::uuid,
          'PAYMENT_CONCURRENCY_CONFLICT', v_payload, jsonb_build_object('error', SQLERRM)
        );
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'CONFLICT_RECORDED', 'error', SQLERRM);
      ELSE
        v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'REJECTED_FINAL', 'error', SQLERRM);
      END IF;
      v_failed := v_failed + 1;
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
