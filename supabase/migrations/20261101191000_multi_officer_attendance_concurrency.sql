-- ==============================================================================
-- UniTap 2.0: Multi-Officer NFC Attendance Concurrency & Revocation Engine
-- Solves:
--   1. Simultaneous NFC Scanning Concurrency (Race conditions between officers)
--   2. Authoritative Single Record Per (occurrence_id, student_id)
--   3. Secure Attendance Revocation with Mandatory Reason & Immutable Audit
--   4. Recheck After Revocation (Prevents silent un-revoking via second NFC tap)
--   5. Full Audit Trail Inclusion in Batch Pull (attendance_audit sync)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA HARDENING ON ATTENDANCE TABLES
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS attendance_records ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE IF EXISTS attendance_records ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE IF EXISTS attendance_records ADD COLUMN IF NOT EXISTS revoked_by_user_id UUID REFERENCES users(id);
ALTER TABLE IF EXISTS attendance_records ADD COLUMN IF NOT EXISTS revocation_reason TEXT;

-- Index for quick occurrence + status queries
CREATE INDEX IF NOT EXISTS idx_attendance_records_occ_status 
ON attendance_records (occurrence_id, status);

-- Audit table additions
ALTER TABLE IF EXISTS attendance_audit ADD COLUMN IF NOT EXISTS occurrence_id UUID;
ALTER TABLE IF EXISTS attendance_audit ADD COLUMN IF NOT EXISTS student_id UUID;
ALTER TABLE IF EXISTS attendance_audit ADD COLUMN IF NOT EXISTS old_status VARCHAR(30);
ALTER TABLE IF EXISTS attendance_audit ADD COLUMN IF NOT EXISTS new_status VARCHAR(30);
ALTER TABLE IF EXISTS attendance_audit ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_attendance_audit_att_id ON attendance_audit(attendance_id, performed_at DESC);

-- ------------------------------------------------------------------------------
-- 2. ATOMIC SERVER-SIDE SCAN OPERATION: record_attendance_scan
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_attendance_scan(
  p_occurrence_id UUID,
  p_student_id UUID,
  p_nfc_card_id UUID DEFAULT NULL,
  p_uid_normalized VARCHAR(64) DEFAULT NULL,
  p_status_override VARCHAR(20) DEFAULT NULL,
  p_device_id TEXT DEFAULT 'dev_default',
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_occurrence RECORD;
  v_student RECORD;
  v_existing RECORD;
  v_suggested_status VARCHAR(20) := 'PRESENT';
  v_record_id UUID;
  v_audit_id UUID;
  v_now TIMESTAMPTZ := now();
  v_late_threshold TIMESTAMPTZ;
  v_revoker_name TEXT;
BEGIN
  -- 1. Authenticate caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Authentication required to confirm attendance.'
    );
  END IF;

  -- 2. Validate officer or devadmin role
  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Officer or DevAdmin permissions required to scan attendance.'
    );
  END IF;

  -- 3. Validate occurrence state (must be OPEN)
  SELECT eo.*, ev.semester_id, ev.title as event_title
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

  IF v_occurrence.status <> 'OPEN' THEN
    RETURN jsonb_build_object(
      'status', 'OCCURRENCE_CLOSED',
      'message', format('This event session is %s and not accepting attendance.', v_occurrence.status)
    );
  END IF;

  -- 4. Validate student active status
  SELECT * INTO v_student
  FROM students
  WHERE id = p_student_id AND status = 'ACTIVE';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'NOT_ELIGIBLE',
      'message', 'Student record not found or inactive.'
    );
  END IF;

  -- 5. ATOMIC ROW-LEVEL CONCURRENCY CHECK
  -- Acquire row-level lock on existing attendance record if it already exists
  SELECT * INTO v_existing
  FROM attendance_records
  WHERE occurrence_id = p_occurrence_id AND student_id = p_student_id
  FOR UPDATE;

  IF FOUND THEN
    -- If previously revoked: DO NOT silently undo! Require explicit recheck!
    IF v_existing.status = 'REVOKED' THEN
      SELECT coalesce(username, 'Authorized Officer') INTO v_revoker_name
      FROM users WHERE id = v_existing.revoked_by_user_id;

      RETURN jsonb_build_object(
        'status', 'REVOKED_REVIEW_REQUIRED',
        'message', format('Attendance was revoked by %s. Reason: "%s". Explicit recheck authorization required.', coalesce(v_revoker_name, 'Officer'), coalesce(v_existing.revocation_reason, 'No reason specified')),
        'attendance_record', to_jsonb(v_existing),
        'revoked_at', v_existing.revoked_at,
        'revocation_reason', v_existing.revocation_reason
      );
    END IF;

    -- If already confirmed present or late:
    IF v_existing.status IN ('PRESENT', 'LATE') THEN
      RETURN jsonb_build_object(
        'status', 'ALREADY_RECORDED',
        'message', format('%s %s is already recorded as %s at %s.', v_student.first_name, v_student.last_name, v_existing.status, to_char(v_existing.checked_in_at, 'HH12:MI AM')),
        'attendance_record', to_jsonb(v_existing)
      );
    END IF;
  END IF;

  -- 6. Calculate Grace Period (PRESENT vs LATE)
  IF p_status_override IS NOT NULL AND p_status_override IN ('PRESENT', 'LATE') THEN
    v_suggested_status := p_status_override;
  ELSIF v_occurrence.occurs_on IS NOT NULL AND v_occurrence.starts_at IS NOT NULL THEN
    v_late_threshold := (v_occurrence.occurs_on::text || ' ' || v_occurrence.starts_at::text)::timestamptz + (coalesce(v_occurrence.grace_minutes, 15) || ' minutes')::interval;
    IF v_now > v_late_threshold THEN
      v_suggested_status := 'LATE';
    END IF;
  END IF;

  -- 7. ATOMIC RECORD CREATION OR REINSTATEMENT
  IF v_existing.id IS NOT NULL THEN
    -- Update existing record (e.g. from ABSENT to PRESENT)
    UPDATE attendance_records
    SET status = v_suggested_status,
        checked_in_at = v_now,
        method = 'NFC',
        photo_checked = 1,
        identity_verified_by_user_id = v_user_id,
        version = version + 1,
        updated_at = v_now
    WHERE id = v_existing.id;

    v_record_id := v_existing.id;
  ELSE
    -- Insert new canonical record
    v_record_id := gen_random_uuid();
    INSERT INTO attendance_records (
      id, occurrence_id, student_id, status, checked_in_at,
      method, photo_checked, identity_verified_by_user_id,
      version, updated_at
    ) VALUES (
      v_record_id, p_occurrence_id, p_student_id, v_suggested_status, v_now,
      'NFC', 1, v_user_id,
      1, v_now
    );
  END IF;

  -- 8. Append Immutable Audit Entry
  v_audit_id := gen_random_uuid();
  INSERT INTO attendance_audit (
    id, attendance_id, occurrence_id, student_id, action,
    old_status, new_status, reason, performed_by_user_id, performed_at
  ) VALUES (
    v_audit_id, v_record_id, p_occurrence_id, p_student_id, 'CHECK_IN',
    coalesce(v_existing.status, 'NOT_RECORDED'), v_suggested_status,
    'Officer NFC identity confirmation', v_user_id, v_now
  );

  -- 9. Log Scan Attempt
  IF p_uid_normalized IS NOT NULL THEN
    INSERT INTO attendance_attempts (
      id, occurrence_id, card_uid, student_id, actor_user_id,
      result, reason, attempted_at
    ) VALUES (
      gen_random_uuid(), p_occurrence_id, p_uid_normalized, p_student_id, v_user_id,
      'CONFIRMED', v_suggested_status, v_now
    );
  END IF;

  -- Return canonical confirmation
  RETURN jsonb_build_object(
    'status', 'RECORDED',
    'message', format('%s %s successfully confirmed as %s!', v_student.first_name, v_student.last_name, v_suggested_status),
    'attendance_record', jsonb_build_object(
      'id', v_record_id,
      'occurrence_id', p_occurrence_id,
      'student_id', p_student_id,
      'status', v_suggested_status,
      'checked_in_at', v_now,
      'identity_verified_by_user_id', v_user_id,
      'version', coalesce(v_existing.version, 0) + 1
    )
  );
EXCEPTION WHEN unique_violation THEN
  -- Handled concurrent race: Another officer committed milliseconds before
  SELECT * INTO v_existing
  FROM attendance_records
  WHERE occurrence_id = p_occurrence_id AND student_id = p_student_id;

  RETURN jsonb_build_object(
    'status', 'ALREADY_RECORDED',
    'message', format('Simultaneous scan detected: Already confirmed as %s.', coalesce(v_existing.status, 'PRESENT')),
    'attendance_record', to_jsonb(v_existing)
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. ATOMIC ATTENDANCE REVOCATION: revoke_attendance
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_attendance(
  p_attendance_id UUID,
  p_reason TEXT,
  p_expected_version INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_rec RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_reason TEXT;
BEGIN
  -- 1. Authenticate caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Officer privileges required.');
  END IF;

  v_clean_reason := trim(p_reason);
  IF v_clean_reason IS NULL OR length(v_clean_reason) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_REASON', 'error', 'A mandatory reason is required to revoke attendance.');
  END IF;

  -- 2. Lock attendance row
  SELECT * INTO v_rec
  FROM attendance_records
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'error', 'Attendance record not found.');
  END IF;

  IF v_rec.status = 'REVOKED' THEN
    RETURN jsonb_build_object(
      'success', true, 
      'status', 'ALREADY_REVOKED', 
      'message', 'Attendance record is already revoked.',
      'attendance_record', to_jsonb(v_rec)
    );
  END IF;

  -- 3. Optimistic Concurrency Control (Version Check)
  IF p_expected_version IS NOT NULL AND v_rec.version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'success', false,
      'status', 'STALE_STATE_CONFLICT',
      'error', 'The record was modified by another officer. Please refresh.',
      'current_version', v_rec.version,
      'attendance_record', to_jsonb(v_rec)
    );
  END IF;

  -- 4. Atomic Transition to REVOKED
  UPDATE attendance_records
  SET status = 'REVOKED',
      revoked_at = v_now,
      revoked_by_user_id = v_user_id,
      revocation_reason = v_clean_reason,
      version = version + 1,
      updated_at = v_now
  WHERE id = p_attendance_id;

  -- 5. Append Immutable Audit
  INSERT INTO attendance_audit (
    id, attendance_id, occurrence_id, student_id, action,
    old_status, new_status, reason, performed_by_user_id, performed_at
  ) VALUES (
    gen_random_uuid(), p_attendance_id, v_rec.occurrence_id, v_rec.student_id, 'REVOKE',
    v_rec.status, 'REVOKED', v_clean_reason, v_user_id, v_now
  );

  RETURN jsonb_build_object(
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_attendance(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_attendance(UUID, TEXT, INT) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. ATOMIC ATTENDANCE RECHECK / REINSTATEMENT: recheck_attendance
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recheck_attendance(
  p_attendance_id UUID,
  p_reason TEXT,
  p_target_status VARCHAR(20) DEFAULT 'PRESENT'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_rec RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_reason TEXT;
  v_status VARCHAR(20);
BEGIN
  -- 1. Authenticate caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Authentication required.');
  END IF;

  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RETURN jsonb_build_object('success', false, 'status', 'UNAUTHORIZED', 'error', 'Officer privileges required.');
  END IF;

  v_clean_reason := trim(p_reason);
  IF v_clean_reason IS NULL OR length(v_clean_reason) = 0 THEN
    RETURN jsonb_build_object('success', false, 'status', 'INVALID_REASON', 'error', 'A mandatory reason is required to recheck attendance.');
  END IF;

  v_status := CASE WHEN p_target_status IN ('PRESENT', 'LATE') THEN p_target_status ELSE 'PRESENT' END;

  -- 2. Lock attendance row
  SELECT * INTO v_rec
  FROM attendance_records
  WHERE id = p_attendance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_FOUND', 'error', 'Attendance record not found.');
  END IF;

  IF v_rec.status <> 'REVOKED' THEN
    RETURN jsonb_build_object('success', false, 'status', 'NOT_REVOKED', 'error', 'Attendance record is not in REVOKED state.');
  END IF;

  -- 3. Atomic Transition back to PRESENT / LATE
  UPDATE attendance_records
  SET status = v_status,
      revoked_at = NULL,
      revoked_by_user_id = NULL,
      revocation_reason = NULL,
      identity_verified_by_user_id = v_user_id,
      version = version + 1,
      updated_at = v_now
  WHERE id = p_attendance_id;

  -- 4. Append Immutable Audit
  INSERT INTO attendance_audit (
    id, attendance_id, occurrence_id, student_id, action,
    old_status, new_status, reason, performed_by_user_id, performed_at
  ) VALUES (
    gen_random_uuid(), p_attendance_id, v_rec.occurrence_id, v_rec.student_id, 'RECHECK_APPROVED',
    'REVOKED', v_status, v_clean_reason, v_user_id, v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'REINSTATED',
    'message', format('Attendance successfully reinstated as %s.', v_status),
    'attendance_record', jsonb_build_object(
      'id', p_attendance_id,
      'occurrence_id', v_rec.occurrence_id,
      'student_id', v_rec.student_id,
      'status', v_status,
      'version', v_rec.version + 1
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recheck_attendance(UUID, TEXT, VARCHAR) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recheck_attendance(UUID, TEXT, VARCHAR) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. UPDATE BATCH PULL TO INCLUDE ATTENDANCE AUDIT (Finding H4, Section 12)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_pull_batch(
  p_since timestamptz DEFAULT '1970-01-01 00:00:00+00'::timestamptz,
  p_limit integer DEFAULT 500
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
  v_result JSONB;
BEGIN
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

  -- Build aggregated JSON payload
  v_result := jsonb_build_object(
    'server_time', now(),
    'academic_years', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM academic_years WHERE updated_at > p_since ORDER BY updated_at ASC LIMIT p_limit) t
    ),
    'semesters', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM semesters WHERE updated_at > p_since ORDER BY updated_at ASC LIMIT p_limit) t
    ),
    'programs', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM programs LIMIT p_limit) t
    ),
    'year_levels', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM year_levels WHERE updated_at > p_since ORDER BY updated_at ASC LIMIT p_limit) t
    ),
    'sections', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM sections WHERE updated_at > p_since ORDER BY updated_at ASC LIMIT p_limit) t
    ),
    'event_categories', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM event_categories WHERE updated_at > p_since ORDER BY updated_at ASC LIMIT p_limit) t
    ),
    'obligation_rules', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM obligation_rules WHERE coalesce(updated_at, created_at) > p_since ORDER BY coalesce(updated_at, created_at) ASC LIMIT p_limit) t
    ),
    'events', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM events WHERE updated_at > p_since ORDER BY updated_at ASC LIMIT p_limit) t
    ),
    'event_occurrences', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM event_occurrences WHERE updated_at > p_since ORDER BY updated_at ASC LIMIT p_limit) t
    ),
    'event_participants', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM event_participants 
        WHERE (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        LIMIT p_limit
      ) t
    ),
    'students', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM students 
        WHERE updated_at > p_since 
          AND (v_role IN ('DEVADMIN', 'OFFICER') OR id = v_student_id)
        ORDER BY updated_at ASC
        LIMIT p_limit
      ) t
    ),
    'student_enrollments', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM student_enrollments 
        WHERE (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        LIMIT p_limit
      ) t
    ),
    'nfc_cards', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM nfc_cards 
        WHERE (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        LIMIT p_limit
      ) t
    ),
    'attendance_records', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM attendance_records 
        WHERE updated_at > p_since 
          AND (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        ORDER BY updated_at ASC
        LIMIT p_limit
      ) t
    ),
    'attendance_audit', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT aa.*
        FROM attendance_audit aa
        JOIN attendance_records ar ON ar.id = aa.attendance_id
        WHERE aa.performed_at > p_since
          AND (v_role IN ('DEVADMIN', 'OFFICER') OR ar.student_id = v_student_id)
        ORDER BY aa.performed_at ASC
        LIMIT p_limit
      ) t
    ),
    'student_obligations', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM student_obligations 
        WHERE updated_at > p_since 
          AND (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        ORDER BY updated_at ASC
        LIMIT p_limit
      ) t
    ),
    'payments', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM payments 
        WHERE (coalesce(updated_at, processed_at) > p_since)
          AND (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        ORDER BY coalesce(updated_at, processed_at) ASC
        LIMIT p_limit
      ) t
    ),
    'payment_allocations', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT pa.* 
        FROM payment_allocations pa
        JOIN payments p ON p.id = pa.payment_id
        WHERE (v_role IN ('DEVADMIN', 'OFFICER') OR p.student_id = v_student_id)
        LIMIT p_limit
      ) t
    )
  );

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_pull_batch(timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_pull_batch(timestamptz, integer) TO authenticated;

-- ------------------------------------------------------------------------------
-- 6. ENABLE SUPABASE REALTIME ON ATTENDANCE TABLES
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'attendance_records'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance_records;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'attendance_audit'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance_audit;
  END IF;
END $$;
