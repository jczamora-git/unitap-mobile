-- ==============================================================================
-- Migration: 20261110020000_checkpoint_late_attendance_windows.sql
-- Description:
--   UniTap 2.0 Attendance Checkpoint Late Attendance Time Window Enforcement:
--   1. Separates the three checkpoint timing concepts:
--      - Opens At: Earliest allowed attendance scan (v_window_start).
--      - On-Time Until: Last time attendance counts as PRESENT (v_window_end).
--      - Accept Late Until: Final cutoff for accepting LATE attendance (v_window_late_cutoff).
--   2. Updates public.record_attendance_scan RPC to parse lateUntil from checkpoints_json.
--   3. Scanner behavior:
--      - Before opening: CHECKPOINT_NOT_OPEN.
--      - Within on-time window (inclusive): PRESENT.
--      - After on-time cutoff but within late cutoff: LATE.
--      - After late cutoff (or closesAt if no lateUntil specified): CHECKPOINT_CLOSED.
--   4. Preserves OUT checkpoint semantics (OUT checkpoints do not use late windows).
--   5. Preserves fail-closed officer appointment, scope, idempotency, duplicate protection,
--      and audit logging.
-- ==============================================================================

BEGIN;

-- Drop previous signatures to prevent overload collisions
DROP FUNCTION IF EXISTS public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT, TIMESTAMPTZ, VARCHAR, INT, TEXT);
DROP FUNCTION IF EXISTS public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT, TIMESTAMPTZ, VARCHAR, INT, TEXT, VARCHAR);

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
  p_manual_reason TEXT DEFAULT NULL,
  p_checkpoint_id VARCHAR(64) DEFAULT 'default_in'
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
  v_window_start TIMESTAMPTZ;
  v_window_end TIMESTAMPTZ;
  v_window_late_cutoff TIMESTAMPTZ;
  v_late_threshold TIMESTAMPTZ;
  v_revoker_name TEXT;
  v_result JSONB;
  v_audit_flags TEXT := NULL;

  -- Checkpoint fields
  v_checkpoint_id VARCHAR(64) := coalesce(nullif(trim(p_checkpoint_id), ''), 'default_in');
  v_checkpoint_found BOOLEAN := false;
  v_checkpoint_type TEXT := 'IN';
  v_checkpoint_label TEXT := 'General Check-In';
  v_chk JSONB;
  v_chk_start_str TEXT;
  v_chk_end_str TEXT;
  v_chk_late_str TEXT;
  v_chk_grace INT := 15;
  v_audit_action TEXT := 'CHECK_IN';
BEGIN
  -- 1. Authenticate caller (Fail-closed: auth.uid() required)
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Authentication required to confirm attendance.'
    );
  END IF;

  -- 2. Validate caller account status in public.users
  SELECT * INTO v_user_rec
  FROM public.users
  WHERE id = v_user_id;

  IF NOT FOUND OR coalesce(v_user_rec.account_status, 'ACTIVE') <> 'ACTIVE' THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Caller account is suspended, inactive, or not found.'
    );
  END IF;

  -- 3. Fail-closed role authorization check
  v_role := public.get_current_user_role();
  IF coalesce(v_role, '') NOT IN ('DEVADMIN', 'OFFICER') THEN
    RETURN jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'message', 'Officer or DevAdmin permissions required to scan attendance.'
    );
  END IF;

  -- 4. Validate Occurrence State
  SELECT eo.*, ev.semester_id, ev.title as event_title, ev.event_type, ev.id as parent_event_id,
         ev.audience_type, ev.audience_json
  INTO v_occurrence
  FROM public.event_occurrences eo
  JOIN public.events ev ON ev.id = eo.event_id
  WHERE eo.id = p_occurrence_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'NOT_FOUND',
      'message', 'Event occurrence not found.'
    );
  END IF;

  -- 5. Active Officer Scope & Appointment Validation (DEVADMIN bypasses appointment requirement)
  IF v_role = 'OFFICER' THEN
    SELECT * INTO v_officer_appt
    FROM public.officer_appointments
    WHERE user_id = v_user_id
      AND status = 'ACTIVE'
      AND semester_id = v_occurrence.semester_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'status', 'UNAUTHORIZED',
        'message', 'Officer does not hold an active appointment for this semester.'
      );
    END IF;

    -- Enforce Scopes
    IF v_officer_appt.scope_type = 'ORGANIZATION' THEN
      NULL; -- Allowed full organization scope
    ELSIF v_officer_appt.scope_type = 'YEAR_LEVEL' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.student_enrollments se 
        WHERE se.student_id = p_student_id 
          AND se.year_level::text = v_officer_appt.scope_id
          AND se.semester_id = v_occurrence.semester_id::text
      ) THEN
        RETURN jsonb_build_object(
          'status', 'FORBIDDEN_SCOPE',
          'message', 'Student does not belong to authorized officer year level scope for this semester.'
        );
      END IF;
    ELSIF v_officer_appt.scope_type = 'PROGRAM' AND v_officer_appt.scope_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.student_enrollments se 
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
        SELECT 1 FROM public.student_enrollments se 
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

  -- 6. Validate Checkpoint Configuration & Active Checkpoint
  IF v_occurrence.checkpoints_json IS NOT NULL 
     AND jsonb_typeof(v_occurrence.checkpoints_json) = 'array' 
     AND jsonb_array_length(v_occurrence.checkpoints_json) > 0 THEN
    FOR v_chk IN SELECT * FROM jsonb_array_elements(v_occurrence.checkpoints_json)
    LOOP
      IF v_chk->>'id' = v_checkpoint_id THEN
        v_checkpoint_found := true;
        v_checkpoint_type := upper(coalesce(v_chk->>'type', 'IN'));
        v_checkpoint_label := coalesce(v_chk->>'label', 'Check-In');
        v_chk_start_str := coalesce(v_chk->>'opensAt', v_chk->>'startTime', v_chk->>'starts_at');
        v_chk_end_str := coalesce(v_chk->>'closesAt', v_chk->>'endTime', v_chk->>'ends_at');
        v_chk_late_str := coalesce(v_chk->>'lateUntil', v_chk->>'late_until');
        v_chk_grace := coalesce((v_chk->>'graceMinutes')::int, 15);
        EXIT;
      END IF;
    END LOOP;

    IF NOT v_checkpoint_found THEN
      RETURN jsonb_build_object(
        'status', 'INVALID_CHECKPOINT',
        'message', format('Checkpoint "%s" is not configured for this event occurrence.', v_checkpoint_id)
      );
    END IF;
  ELSE
    -- Default single checkpoint fallback
    IF v_checkpoint_id = 'default_in' THEN
      v_checkpoint_found := true;
      v_checkpoint_type := 'IN';
      v_checkpoint_label := 'General Check-In';
      v_chk_start_str := v_occurrence.starts_at::text;
      v_chk_end_str := v_occurrence.ends_at::text;
      v_chk_late_str := NULL;
      v_chk_grace := coalesce(v_occurrence.grace_minutes, 15);
    ELSE
      RETURN jsonb_build_object(
        'status', 'INVALID_CHECKPOINT',
        'message', format('Checkpoint "%s" is not valid. No custom checkpoints configured.', v_checkpoint_id)
      );
    END IF;
  END IF;

  -- Fall back to occurrence start/end if checkpoint times are omitted
  IF v_chk_start_str IS NULL THEN
    v_chk_start_str := v_occurrence.starts_at::text;
  END IF;
  IF v_chk_end_str IS NULL THEN
    v_chk_end_str := v_occurrence.ends_at::text;
  END IF;

  -- Ensure submitted checkpoint matches active checkpoint if an active checkpoint is enforced
  IF v_occurrence.active_checkpoint_id IS NOT NULL AND trim(v_occurrence.active_checkpoint_id) <> '' THEN
    IF v_checkpoint_id <> trim(v_occurrence.active_checkpoint_id) THEN
      RETURN jsonb_build_object(
        'status', 'CHECKPOINT_NOT_ACTIVE',
        'message', format('Checkpoint "%s" is not currently active. Active checkpoint is "%s".', v_checkpoint_id, v_occurrence.active_checkpoint_id)
      );
    END IF;
  END IF;

  -- 7. Authoritative Server-Side Time Window Enforcement (Asia/Manila UTC+8)
  IF v_occurrence.occurs_on IS NOT NULL AND v_chk_start_str IS NOT NULL AND v_chk_end_str IS NOT NULL THEN
    v_window_start := (v_occurrence.occurs_on::text || ' ' || v_chk_start_str)::timestamp AT TIME ZONE 'Asia/Manila';
    v_window_end   := (v_occurrence.occurs_on::text || ' ' || v_chk_end_str)::timestamp AT TIME ZONE 'Asia/Manila';

    -- Compute Late Acceptance Cutoff
    IF v_checkpoint_type = 'IN' AND v_chk_late_str IS NOT NULL AND trim(v_chk_late_str) <> '' THEN
      v_window_late_cutoff := (v_occurrence.occurs_on::text || ' ' || v_chk_late_str)::timestamp AT TIME ZONE 'Asia/Manila';
    ELSE
      v_window_late_cutoff := v_window_end;
    END IF;

    IF v_now < v_window_start THEN
      v_result := jsonb_build_object(
        'status', 'CHECKPOINT_NOT_OPEN',
        'message', format('Checkpoint "%s" (%s) is not open for scanning yet. Scanning window opens at %s (Asia/Manila).',
          v_checkpoint_label, v_checkpoint_id, to_char(v_window_start AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')),
        'checkpoint_id', v_checkpoint_id,
        'checkpoint_label', v_checkpoint_label,
        'checkpoint_type', v_checkpoint_type,
        'opens_at', v_chk_start_str,
        'closes_at', v_chk_end_str,
        'late_until', v_chk_late_str,
        'server_time', to_char(v_now AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD"T"HH24:MI:SSOF')
      );

      INSERT INTO public.attendance_attempts (
        id, occurrence_id, card_uid, student_id, actor_user_id,
        result, reason, attempted_at
      ) VALUES (
        gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
        'CHECKPOINT_NOT_OPEN', format('Scan rejected: checkpoint window opens at %s (Asia/Manila)', v_chk_start_str), v_now
      );

      RETURN v_result;

    ELSIF v_now > v_window_late_cutoff THEN
      v_result := jsonb_build_object(
        'status', 'CHECKPOINT_CLOSED',
        'message', format('Checkpoint "%s" (%s) scanning window has closed. Cutoff was %s (Asia/Manila).',
          v_checkpoint_label, v_checkpoint_id, to_char(v_window_late_cutoff AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')),
        'checkpoint_id', v_checkpoint_id,
        'checkpoint_label', v_checkpoint_label,
        'checkpoint_type', v_checkpoint_type,
        'opens_at', v_chk_start_str,
        'closes_at', v_chk_end_str,
        'late_until', v_chk_late_str,
        'server_time', to_char(v_now AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD"T"HH24:MI:SSOF')
      );

      INSERT INTO public.attendance_attempts (
        id, occurrence_id, card_uid, student_id, actor_user_id,
        result, reason, attempted_at
      ) VALUES (
        gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
        'CHECKPOINT_CLOSED', format('Scan rejected: checkpoint cutoff reached at %s (Asia/Manila)', to_char(v_window_late_cutoff AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')), v_now
      );

      RETURN v_result;
    END IF;
  END IF;

  -- 8. True Transactional Idempotency Reservation
  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    v_fingerprint := md5(
      p_occurrence_id::text || ':' ||
      p_student_id::text || ':' ||
      v_checkpoint_id || ':' ||
      coalesce(p_nfc_card_id::text, '') || ':' ||
      coalesce(lower(p_uid_normalized), '') || ':' ||
      coalesce(p_scan_method, 'NFC') || ':' ||
      coalesce(to_char(p_client_scanned_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
    );

    SELECT * INTO v_receipt_rec
    FROM public.attendance_operation_receipts
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

      IF v_receipt_rec.status = 'COMPLETED' THEN
        RETURN v_receipt_rec.response_payload;
      ELSIF v_receipt_rec.status = 'FAILED' THEN
        RETURN v_receipt_rec.response_payload;
      ELSIF v_receipt_rec.status = 'PENDING' AND v_receipt_rec.created_at < (now() - interval '30 seconds') THEN
        -- Timeout recovery
        UPDATE public.attendance_operation_receipts
        SET status = 'PENDING', created_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      ELSE
        RETURN jsonb_build_object(
          'status', 'CONCURRENT_REQUEST',
          'message', 'Identical scan request is currently processing.'
        );
      END IF;
    ELSE
      INSERT INTO public.attendance_operation_receipts (
        idempotency_key, user_id, occurrence_id, student_id, checkpoint_id,
        request_fingerprint, status, created_at
      ) VALUES (
        trim(p_idempotency_key), v_user_id, p_occurrence_id, p_student_id, v_checkpoint_id,
        v_fingerprint, 'PENDING', now()
      );
    END IF;
  END IF;

  -- 9. Validate Target Student
  SELECT * INTO v_student
  FROM public.students
  WHERE id = p_student_id;

  IF NOT FOUND THEN
    v_result := jsonb_build_object(
      'status', 'STUDENT_NOT_FOUND',
      'message', 'Target student does not exist.'
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE public.attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 10. Strict Hardware Authentication & Cryptographic Association (NFC)
  IF p_scan_method = 'NFC' THEN
    IF p_nfc_card_id IS NOT NULL AND p_uid_normalized IS NOT NULL THEN
      SELECT * INTO v_nfc_card
      FROM public.nfc_cards
      WHERE id = p_nfc_card_id 
        AND lower(uid_normalized) = lower(trim(p_uid_normalized))
        AND status = 'ACTIVE';

      IF NOT FOUND THEN
        v_result := jsonb_build_object(
          'status', 'NFC_IDENTITY_INCONSISTENT',
          'message', 'Supplied NFC card ID and card UID do not match the same active card.'
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE public.attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    ELSE
      SELECT * INTO v_nfc_card
      FROM public.nfc_cards
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
          UPDATE public.attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    END IF;

    IF v_nfc_card.student_id <> p_student_id THEN
      v_result := jsonb_build_object(
        'status', 'CARD_STUDENT_MISMATCH',
        'message', 'Scanned NFC card is registered to a different student.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE public.attendance_operation_receipts 
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
        UPDATE public.attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;
    v_audit_flags := 'MANUAL_OVERRIDE';
  END IF;

  -- 11. Eligibility & Roster Validation
  IF v_occurrence.audience_type IS NOT NULL AND v_occurrence.audience_type <> 'ALL' THEN
    IF v_occurrence.audience_type = 'YEAR_LEVEL' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.student_enrollments se
        WHERE se.student_id = p_student_id
          AND se.semester_id = v_occurrence.semester_id::text
          AND (v_occurrence.audience_json->'year_levels') ? (se.year_level::text)
      ) THEN
        v_result := jsonb_build_object(
          'status', 'NOT_ELIGIBLE',
          'message', 'Student year level is not eligible for this event.'
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE public.attendance_operation_receipts 
          SET status = 'FAILED', response_payload = v_result, completed_at = now()
          WHERE idempotency_key = trim(p_idempotency_key);
        END IF;
        RETURN v_result;
      END IF;
    ELSIF v_occurrence.audience_type = 'PROGRAM' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.student_enrollments se
        WHERE se.student_id = p_student_id
          AND se.semester_id = v_occurrence.semester_id::text
          AND (v_occurrence.audience_json->'program_ids') ? se.program_id
      ) THEN
        v_result := jsonb_build_object(
          'status', 'NOT_ELIGIBLE',
          'message', 'Student program is not eligible for this event.'
        );
        IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
          UPDATE public.attendance_operation_receipts 
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
        UPDATE public.attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;
  END IF;

  -- 12. Scoped Duplicate Check (by occurrence_id, student_id, and checkpoint_id)
  SELECT * INTO v_existing
  FROM public.attendance_records
  WHERE occurrence_id = p_occurrence_id 
    AND student_id = p_student_id
    AND checkpoint_id = v_checkpoint_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'REVOKED' THEN
      SELECT coalesce(username, 'Authorized Officer') INTO v_revoker_name
      FROM public.users WHERE id = v_existing.revoked_by_user_id;

      INSERT INTO public.attendance_attempts (
        id, occurrence_id, card_uid, student_id, actor_user_id,
        result, reason, attempted_at
      ) VALUES (
        gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
        'REVOKED_REVIEW_REQUIRED', coalesce(v_existing.revocation_reason, 'Revoked record re-scan blocked'), v_now
      );

      v_result := jsonb_build_object(
        'status', 'REVOKED_RECORD',
        'message', format('Attendance for checkpoint "%s" was revoked by %s (%s). Manual reinstatement required.',
          v_checkpoint_label, v_revoker_name, coalesce(v_existing.revocation_reason, 'No reason specified')),
        'revoked_by', v_revoker_name,
        'revocation_reason', v_existing.revocation_reason
      );

      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE public.attendance_operation_receipts
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;

      RETURN v_result;
    END IF;

    IF v_existing.status IN ('PRESENT', 'LATE') THEN
      INSERT INTO public.attendance_attempts (
        id, occurrence_id, card_uid, student_id, actor_user_id,
        result, reason, attempted_at
      ) VALUES (
        gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
        'ALREADY_RECORDED', format('Duplicate scan for checkpoint "%s" (%s). Already recorded as %s', v_checkpoint_label, v_checkpoint_id, v_existing.status), v_now
      );

      v_result := jsonb_build_object(
        'status', 'DUPLICATE',
        'message', format('%s %s has already recorded %s for checkpoint "%s" at %s.', v_student.first_name, v_student.last_name, v_existing.status, v_checkpoint_label, to_char(v_existing.checked_in_at AT TIME ZONE 'Asia/Manila', 'HH12:MI AM')),
        'attendance_record', to_jsonb(v_existing),
        'checkpoint_id', v_checkpoint_id,
        'checkpoint_type', v_checkpoint_type,
        'checkpoint_label', v_checkpoint_label
      );

      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE public.attendance_operation_receipts
        SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;

      RETURN v_result;
    END IF;
  END IF;

  -- 13. Determine Suggested Status based on On-Time window (for IN checkpoints)
  v_scan_time := v_now; -- Authoritative server timestamp

  IF v_checkpoint_type = 'IN' THEN
    IF v_window_end IS NOT NULL AND v_now > v_window_end THEN
      v_suggested_status := 'LATE';
    ELSE
      v_suggested_status := 'PRESENT';
    END IF;
  ELSE
    -- Checkpoint type OUT is PRESENT when scanned within its window
    v_suggested_status := 'PRESENT';
  END IF;

  IF v_role = 'DEVADMIN' AND p_status_override IS NOT NULL AND p_status_override IN ('PRESENT', 'LATE', 'EXCUSED') THEN
    v_suggested_status := p_status_override;
  END IF;

  -- 14. Atomic Insert or Update in attendance_records
  IF v_existing.id IS NOT NULL THEN
    UPDATE public.attendance_records
    SET status = v_suggested_status,
        checked_in_at = v_scan_time,
        client_scanned_at = coalesce(p_client_scanned_at, v_now),
        method = p_scan_method,
        photo_checked = coalesce(p_photo_checked, 0),
        identity_verified_by_user_id = v_user_id,
        audit_flags = v_audit_flags,
        notes = coalesce(p_manual_reason, notes),
        version = version + 1,
        updated_at = v_now
      WHERE id = v_existing.id;

    v_record_id := v_existing.id;
  ELSE
    v_record_id := gen_random_uuid();
    INSERT INTO public.attendance_records (
      id, occurrence_id, student_id, checkpoint_id, status, checked_in_at, client_scanned_at,
      method, photo_checked, identity_verified_by_user_id, audit_flags, notes,
      version, updated_at
    ) VALUES (
      v_record_id, p_occurrence_id, p_student_id, v_checkpoint_id, v_suggested_status, v_scan_time, coalesce(p_client_scanned_at, v_now),
      p_scan_method, coalesce(p_photo_checked, 0), v_user_id, v_audit_flags, p_manual_reason,
      1, v_now
    );
  END IF;

  -- 15. Append to Immutable Attendance Audit with exact CHECK_IN vs CHECK_OUT action
  v_audit_action := CASE WHEN v_checkpoint_type = 'OUT' THEN 'CHECK_OUT' ELSE 'CHECK_IN' END;
  v_audit_id := gen_random_uuid();

  INSERT INTO public.attendance_audit (
    id, attendance_id, occurrence_id, student_id, action,
    old_status, new_status, reason, performed_by_user_id, performed_at
  ) VALUES (
    v_audit_id, v_record_id, p_occurrence_id, p_student_id, v_audit_action,
    coalesce(v_existing.status, 'NOT_RECORDED'), v_suggested_status,
    CASE 
      WHEN p_scan_method = 'MANUAL' THEN coalesce(p_manual_reason, format('Manual officer entry [%s: %s]', v_checkpoint_id, v_checkpoint_label))
      ELSE format('Officer scan [%s: %s] via %s (Window %s - %s%s)', v_checkpoint_id, v_checkpoint_label, p_scan_method, v_chk_start_str, v_chk_end_str, CASE WHEN v_chk_late_str IS NOT NULL THEN format(' late until %s', v_chk_late_str) ELSE '' END)
    END,
    v_user_id, v_now
  );

  -- 16. Log Successful Scan Attempt
  INSERT INTO public.attendance_attempts (
    id, occurrence_id, card_uid, student_id, actor_user_id,
    result, reason, attempted_at
  ) VALUES (
    gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
    'CONFIRMED', format('%s [%s: %s]', v_suggested_status, v_checkpoint_id, v_checkpoint_label), v_now
  );

  -- 17. Build Success Payload & Complete Idempotency Reservation
  v_result := jsonb_build_object(
    'status', 'RECORDED',
    'record_id', v_record_id,
    'attendance_status', v_suggested_status,
    'checkpoint_id', v_checkpoint_id,
    'checkpoint_type', v_checkpoint_type,
    'checkpoint_label', v_checkpoint_label,
    'opens_at', v_chk_start_str,
    'closes_at', v_chk_end_str,
    'late_until', v_chk_late_str,
    'message', format('%s %s confirmed as %s for %s (%s)!', v_student.first_name, v_student.last_name, v_suggested_status, v_checkpoint_label, v_checkpoint_type),
    'attendance_record', jsonb_build_object(
      'id', v_record_id,
      'occurrence_id', p_occurrence_id,
      'student_id', p_student_id,
      'checkpoint_id', v_checkpoint_id,
      'status', v_suggested_status,
      'checked_in_at', v_scan_time,
      'client_scanned_at', coalesce(p_client_scanned_at, v_now),
      'identity_verified_by_user_id', v_user_id,
      'photo_checked', coalesce(p_photo_checked, 0),
      'version', coalesce(v_existing.version, 0) + 1,
      'audit_flags', v_audit_flags
    )
  );

  IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
    UPDATE public.attendance_operation_receipts
    SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
    WHERE idempotency_key = trim(p_idempotency_key);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_attendance_scan TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_attendance_scan FROM anon, public;

COMMIT;

