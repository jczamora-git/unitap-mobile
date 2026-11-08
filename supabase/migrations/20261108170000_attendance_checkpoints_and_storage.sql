-- ==============================================================================
-- Migration: 20261108170000_attendance_checkpoints_and_storage.sql
-- Description:
--   UniTap 2.0 Configurable Attendance Checkpoints (IN/OUT) & Student Profile Photos:
--   1. Adds checkpoints_json & active_checkpoint_id to event_occurrences.
--   2. Adds checkpoint_id to attendance_records with updated composite UNIQUE constraint.
--   3. Upgrades record_attendance_scan RPC to support independent checkpoint tracking.
--   4. Configures dedicated Supabase Storage bucket 'student-profile-photos' with RLS.
-- ==============================================================================

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
-- 2. ATOMIC ATTENDANCE SCAN RPC UPGRADE (WITH CHECKPOINT SUPPORT)
-- ------------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.record_attendance_scan(UUID, UUID, UUID, VARCHAR, VARCHAR, TEXT, TEXT, TIMESTAMPTZ, VARCHAR, INT, TEXT);

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
  v_occurrence RECORD;
  v_student RECORD;
  v_nfc_card RECORD;
  v_existing RECORD;
  v_receipt_rec RECORD;
  v_fingerprint TEXT;
  v_suggested_status VARCHAR(20) := 'PRESENT';
  v_record_id UUID;
  v_now TIMESTAMPTZ := now();
  v_scan_time TIMESTAMPTZ;
  v_revoker_name TEXT;
  v_result JSONB;
  v_checkpoint_id VARCHAR(64) := coalesce(nullif(trim(p_checkpoint_id), ''), 'default_in');
BEGIN
  -- 1. Authenticate caller
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

  -- 3. Fail-closed role check
  v_role := public.get_current_user_role();
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

  IF v_occurrence.status <> 'OPEN' THEN
    RETURN jsonb_build_object(
      'status', 'SESSION_CLOSED',
      'message', format('Attendance session "%s" is closed.', v_occurrence.title)
    );
  END IF;

  -- 5. Validate Student
  SELECT * INTO v_student
  FROM students
  WHERE id = p_student_id AND status = 'ACTIVE';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'NOT_ELIGIBLE',
      'message', 'Student record not found or inactive.'
    );
  END IF;

  -- 6. Check for duplicate scan on this specific checkpoint
  SELECT * INTO v_existing
  FROM attendance_records
  WHERE occurrence_id = p_occurrence_id
    AND student_id = p_student_id
    AND checkpoint_id = v_checkpoint_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'REVOKED' THEN
      SELECT coalesce(username, 'Authorized Officer') INTO v_revoker_name
      FROM users WHERE id = v_existing.revoked_by_user_id;

      RETURN jsonb_build_object(
        'status', 'REVOKED_REVIEW_REQUIRED',
        'message', format('Attendance for checkpoint "%s" was revoked by %s.', v_checkpoint_id, coalesce(v_revoker_name, 'Officer')),
        'attendance_record', to_jsonb(v_existing),
        'checkpoint_id', v_checkpoint_id
      );
    END IF;

    IF v_existing.status IN ('PRESENT', 'LATE') THEN
      RETURN jsonb_build_object(
        'status', 'DUPLICATE',
        'message', format('Student has already recorded attendance for checkpoint "%s" (%s).', v_checkpoint_id, v_existing.status),
        'attendance_record', to_jsonb(v_existing),
        'checkpoint_id', v_checkpoint_id
      );
    END IF;
  END IF;

  -- 7. Determine Attendance Status
  v_scan_time := coalesce(p_client_scanned_at, v_now);
  IF p_status_override IS NOT NULL AND p_status_override IN ('PRESENT', 'LATE', 'EXCUSED') THEN
    v_suggested_status := p_status_override;
  ELSE
    v_suggested_status := 'PRESENT';
    IF v_occurrence.occurs_on IS NOT NULL AND v_occurrence.starts_at IS NOT NULL THEN
      IF (v_scan_time > (v_occurrence.occurs_on + v_occurrence.starts_at + make_interval(mins => coalesce(v_occurrence.grace_minutes, 15)))) THEN
        v_suggested_status := 'LATE';
      END IF;
    END IF;
  END IF;

  -- 8. Insert or Update Attendance Record with Checkpoint ID
  INSERT INTO attendance_records (
    id, occurrence_id, student_id, checkpoint_id, status,
    checked_in_at, method, photo_checked, identity_verified_by_user_id,
    notes, updated_at
  ) VALUES (
    gen_random_uuid(), p_occurrence_id, p_student_id, v_checkpoint_id, v_suggested_status,
    v_scan_time, coalesce(p_scan_method, 'NFC'), coalesce(p_photo_checked, 1), v_user_id,
    p_manual_reason, v_now
  )
  ON CONFLICT (occurrence_id, student_id, checkpoint_id) DO UPDATE SET
    status = EXCLUDED.status,
    checked_in_at = EXCLUDED.checked_in_at,
    method = EXCLUDED.method,
    photo_checked = EXCLUDED.photo_checked,
    identity_verified_by_user_id = EXCLUDED.identity_verified_by_user_id,
    notes = EXCLUDED.notes,
    updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_record_id;

  RETURN jsonb_build_object(
    'status', 'RECORDED',
    'record_id', v_record_id,
    'attendance_status', v_suggested_status,
    'checkpoint_id', v_checkpoint_id,
    'message', format('Attendance recorded for checkpoint "%s" (%s)', v_checkpoint_id, v_suggested_status)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_attendance_scan TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_attendance_scan FROM anon, public;

-- ------------------------------------------------------------------------------
-- 3. DEDICATED SUPABASE STORAGE BUCKET FOR STUDENT PROFILE PHOTOS
-- ------------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-profile-photos',
  'student-profile-photos',
  true,
  5242880, -- 5 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- Storage RLS: Public/Authenticated Read
DROP POLICY IF EXISTS "Public access to student photos" ON storage.objects;
CREATE POLICY "Public access to student photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'student-profile-photos');

-- Storage RLS: DEVADMIN and OFFICER Upload
DROP POLICY IF EXISTS "Officers upload student photos" ON storage.objects;
CREATE POLICY "Officers upload student photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
  );

-- Storage RLS: DEVADMIN and OFFICER Update
DROP POLICY IF EXISTS "Officers update student photos" ON storage.objects;
CREATE POLICY "Officers update student photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
  );

-- Storage RLS: DEVADMIN and OFFICER Delete
DROP POLICY IF EXISTS "Officers delete student photos" ON storage.objects;
CREATE POLICY "Officers delete student photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
  );

