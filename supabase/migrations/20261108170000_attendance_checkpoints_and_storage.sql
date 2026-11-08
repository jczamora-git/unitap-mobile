-- ==============================================================================
-- Migration: 20261108170000_attendance_checkpoints_and_storage.sql
-- Description:
--   UniTap 2.0 Configurable Attendance Checkpoints (IN/OUT) & Private Student Profile Photos:
--   1. Adds checkpoints_json & active_checkpoint_id to event_occurrences.
--   2. Adds checkpoint_id to attendance_records with composite UNIQUE constraint.
--   3. Upgrades record_attendance_scan RPC to support independent checkpoint tracking,
--      preserving all fail-closed officer appointment, permission, and scope validations,
--      validating checkpoint membership and schedule, and logging CHECK_IN vs CHECK_OUT.
--   4. Configures PRIVATE Supabase Storage bucket 'student-profile-photos' with authenticated RLS.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. ATTENDANCE CHECKPOINTS SCHEMA
-- ------------------------------------------------------------------------------

-- 1.1. Add checkpoints_json and active_checkpoint_id to event_occurrences
ALTER TABLE public.event_occurrences
  ADD COLUMN IF NOT EXISTS checkpoints_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_checkpoint_id VARCHAR(64) DEFAULT NULL;

-- 1.2. Add checkpoint_id to attendance_records
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS checkpoint_id VARCHAR(64) DEFAULT 'default_in';

-- 1.3. Reconfigure UNIQUE constraint to allow independent scans per checkpoint
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_occurrence_id_student_id_key;

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_occurrence_student_checkpoint_key;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_occurrence_student_checkpoint_key
  UNIQUE (occurrence_id, student_id, checkpoint_id);

-- ------------------------------------------------------------------------------
-- 2. SECURE & HARDENED ATTENDANCE SCAN RPC (WITH CHECKPOINT SUPPORT)
-- ------------------------------------------------------------------------------

-- Drop any previous signatures to prevent overload bypass
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
  v_occ_start TIMESTAMPTZ;
  v_occ_end TIMESTAMPTZ;
  v_late_threshold TIMESTAMPTZ;
  v_revoker_name TEXT;
  v_result JSONB;
  v_audit_flags TEXT := NULL;
  v_has_active_window BOOLEAN := false;

  -- Checkpoint fields
  v_checkpoint_id VARCHAR(64) := coalesce(nullif(trim(p_checkpoint_id), ''), 'default_in');
  v_checkpoint_found BOOLEAN := false;
  v_checkpoint_type TEXT := 'IN';
  v_checkpoint_label TEXT := 'General Check-In';
  v_chk JSONB;
  v_chk_start_str TEXT;
  v_chk_end_str TEXT;
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
        v_chk_start_str := v_chk->>'startTime';
        v_chk_end_str := v_chk->>'endTime';
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
      v_chk_grace := coalesce(v_occurrence.grace_minutes, 15);
    ELSE
      RETURN jsonb_build_object(
        'status', 'INVALID_CHECKPOINT',
        'message', format('Checkpoint "%s" is not valid. No custom checkpoints configured.', v_checkpoint_id)
      );
    END IF;
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

  -- 7. True Transactional Idempotency Reservation
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

      IF v_receipt_rec.status IN ('COMPLETED', 'FAILED') THEN
        RETURN v_receipt_rec.response_payload || jsonb_build_object('is_replay', true);
      END IF;
    ELSE
      INSERT INTO public.attendance_operation_receipts (
        idempotency_key, user_id, operation_type, occurrence_id, student_id,
        request_fingerprint, status, created_at
      ) VALUES (
        trim(p_idempotency_key), v_user_id, 'SCAN', p_occurrence_id, p_student_id,
        v_fingerprint, 'PROCESSING', v_now
      );
    END IF;
  END IF;

  -- 8. Validate Student Active Status
  SELECT * INTO v_student
  FROM public.students
  WHERE id = p_student_id AND status = 'ACTIVE';

  IF NOT FOUND THEN
    v_result := jsonb_build_object(
      'status', 'NOT_ELIGIBLE',
      'message', 'Student record not found or inactive.'
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE public.attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 9. NFC Card Binding & UID Consistency Validation
  IF p_scan_method = 'NFC' THEN
    IF (p_uid_normalized IS NULL OR trim(p_uid_normalized) = '') AND p_nfc_card_id IS NULL THEN
      v_result := jsonb_build_object(
        'status', 'NFC_REQUIRED',
        'message', 'NFC card UID or card reference is required for physical NFC scans.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE public.attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;

    IF p_nfc_card_id IS NOT NULL AND (p_uid_normalized IS NOT NULL AND trim(p_uid_normalized) <> '') THEN
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
  ELSE
    v_result := jsonb_build_object(
      'status', 'INVALID_METHOD',
      'message', format('Unsupported scan method: %s.', p_scan_method)
    );
    IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
      UPDATE public.attendance_operation_receipts 
      SET status = 'FAILED', response_payload = v_result, completed_at = now()
      WHERE idempotency_key = trim(p_idempotency_key);
    END IF;
    RETURN v_result;
  END IF;

  -- 10. Participant Roster & Audience Eligibility
  IF EXISTS (SELECT 1 FROM public.event_participants WHERE occurrence_id = p_occurrence_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.event_participants 
      WHERE occurrence_id = p_occurrence_id AND student_id = p_student_id
    ) THEN
      v_result := jsonb_build_object(
        'status', 'NOT_ELIGIBLE',
        'message', 'Student is not on the participant roster for this occurrence.'
      );
      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE public.attendance_operation_receipts 
        SET status = 'FAILED', response_payload = v_result, completed_at = now()
        WHERE idempotency_key = trim(p_idempotency_key);
      END IF;
      RETURN v_result;
    END IF;
  ELSE
    IF v_occurrence.audience_type = 'PROGRAM' AND v_occurrence.audience_json IS NOT NULL THEN
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

  -- 11. Scoped Duplicate Check (by occurrence_id, student_id, and checkpoint_id)
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
        'status', 'REVOKED_REVIEW_REQUIRED',
        'message', format('Attendance for checkpoint "%s" (%s) was revoked by %s. Reason: "%s". Explicit recheck authorization required.', v_checkpoint_label, v_checkpoint_type, coalesce(v_revoker_name, 'Officer'), coalesce(v_existing.revocation_reason, 'No reason specified')),
        'attendance_record', to_jsonb(v_existing),
        'checkpoint_id', v_checkpoint_id,
        'checkpoint_type', v_checkpoint_type,
        'checkpoint_label', v_checkpoint_label,
        'revoked_at', v_existing.revoked_at,
        'revocation_reason', v_existing.revocation_reason
      );

      IF p_idempotency_key IS NOT NULL AND trim(p_idempotency_key) <> '' THEN
        UPDATE public.attendance_operation_receipts
        SET status = 'COMPLETED', response_payload = v_result, completed_at = now()
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

  -- 12. Checkpoint Schedule Validation & Timestamps
  v_scan_time := coalesce(p_client_scanned_at, v_now);
  IF v_scan_time > v_now + interval '5 minutes' THEN
    v_scan_time := v_now;
    v_audit_flags := 'FUTURE_TIMESTAMP_CLAMPED';
  ELSIF v_scan_time < v_now - interval '7 days' THEN
    v_audit_flags := 'STALE_TIMESTAMP_FLAGGED';
  END IF;

  -- Schedule evaluation: use checkpoint schedule if provided, else occurrence
  IF v_occurrence.occurs_on IS NOT NULL AND v_chk_start_str IS NOT NULL THEN
    v_occ_start := (v_occurrence.occurs_on::text || ' ' || v_chk_start_str)::timestamp AT TIME ZONE 'Asia/Manila';
    v_late_threshold := v_occ_start + (v_chk_grace || ' minutes')::interval;

    IF v_scan_time > v_late_threshold THEN
      v_suggested_status := 'LATE';
    ELSE
      v_suggested_status := 'PRESENT';
    END IF;
  ELSIF v_occurrence.occurs_on IS NOT NULL AND v_occurrence.starts_at IS NOT NULL THEN
    v_occ_start := (v_occurrence.occurs_on::text || ' ' || v_occurrence.starts_at::text)::timestamp AT TIME ZONE 'Asia/Manila';
    v_late_threshold := v_occ_start + (coalesce(v_occurrence.grace_minutes, 15) || ' minutes')::interval;

    IF v_scan_time > v_late_threshold THEN
      v_suggested_status := 'LATE';
    ELSE
      v_suggested_status := 'PRESENT';
    END IF;
  ELSE
    v_suggested_status := 'PRESENT';
  END IF;

  IF v_role = 'DEVADMIN' AND p_status_override IS NOT NULL AND p_status_override IN ('PRESENT', 'LATE', 'EXCUSED') THEN
    v_suggested_status := p_status_override;
  END IF;

  -- 13. Atomic Insert or Update in attendance_records
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

  -- 14. Append to Immutable Attendance Audit with exact CHECK_IN vs CHECK_OUT action
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
      ELSE format('Officer scan [%s: %s] via %s (%s)', v_checkpoint_id, v_checkpoint_label, p_scan_method, coalesce(v_audit_flags, 'NORMAL'))
    END,
    v_user_id, v_now
  );

  -- 15. Log Scan Attempt
  INSERT INTO public.attendance_attempts (
    id, occurrence_id, card_uid, student_id, actor_user_id,
    result, reason, attempted_at
  ) VALUES (
    gen_random_uuid(), p_occurrence_id, coalesce(p_uid_normalized, 'NFC_CARD'), p_student_id, v_user_id,
    'CONFIRMED', format('%s [%s]', v_suggested_status, v_checkpoint_label), v_now
  );

  -- 16. Build Success Payload & Complete Idempotency Reservation
  v_result := jsonb_build_object(
    'status', 'RECORDED',
    'record_id', v_record_id,
    'attendance_status', v_suggested_status,
    'checkpoint_id', v_checkpoint_id,
    'checkpoint_type', v_checkpoint_type,
    'checkpoint_label', v_checkpoint_label,
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

-- ------------------------------------------------------------------------------
-- 3. PRIVATE SUPABASE STORAGE BUCKET FOR STUDENT PROFILE PHOTOS
-- ------------------------------------------------------------------------------

-- Ensure bucket exists and is strictly PRIVATE (public = false)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-profile-photos',
  'student-profile-photos',
  false,
  5242880, -- 5 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Drop any legacy public or insecure policies
DROP POLICY IF EXISTS "Public access to student photos" ON storage.objects;
DROP POLICY IF EXISTS "Officers upload student photos" ON storage.objects;
DROP POLICY IF EXISTS "Officers update student photos" ON storage.objects;
DROP POLICY IF EXISTS "Officers delete student photos" ON storage.objects;
DROP POLICY IF EXISTS "Authorized view student photos" ON storage.objects;

-- Storage RLS: Authenticated Officers & DevAdmin can view all photos;
-- Enrolled Students can view their OWN profile photo via signed URL or direct path match
CREATE POLICY "Authorized view student photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'student-profile-photos'
    AND (
      public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
      OR name LIKE (public.get_current_user_student_id()::text || '/%')
      OR (storage.foldername(name))[1] = public.get_current_user_student_id()::text
    )
  );

-- Storage RLS: Authorized DEVADMIN and active OFFICER accounts can upload photos
CREATE POLICY "Officers upload student photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
  );

-- Storage RLS: Authorized DEVADMIN and active OFFICER accounts can update photos
CREATE POLICY "Officers update student photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
  );

-- Storage RLS: Authorized DEVADMIN and active OFFICER accounts can delete photos
CREATE POLICY "Officers delete student photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
  );

COMMIT;