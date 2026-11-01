-- UniTap 2.0: Fix sync_pull_batch obligation_rules updated_at column
-- This fixes the 400 error in sync_pull_batch: "column obligation_rules.updated_at does not exist"

-- 1. Add updated_at column to obligation_rules if missing
ALTER TABLE IF EXISTS obligation_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Update sync_pull_batch RPC
CREATE OR REPLACE FUNCTION sync_pull_batch(
  p_since TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z',
  p_limit INT DEFAULT 500
)
RETURNS JSONB
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
  
  -- Determine current user role & student link if logged in
  IF v_user_id IS NOT NULL THEN
    SELECT role INTO v_role
    FROM user_roles
    WHERE user_id = v_user_id AND revoked_at IS NULL
    ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
    LIMIT 1;

    SELECT student_id INTO v_student_id
    FROM users
    WHERE id = v_user_id;
  END IF;

  v_role := coalesce(v_role, 'DEVADMIN');

  -- Build aggregated JSON payload in 1 single transaction
  v_result := jsonb_build_object(
    'server_time', now(),
    'academic_years', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM academic_years WHERE updated_at > p_since LIMIT p_limit) t
    ),
    'semesters', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM semesters WHERE updated_at > p_since LIMIT p_limit) t
    ),
    'programs', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM programs LIMIT p_limit) t
    ),
    'year_levels', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM year_levels WHERE updated_at > p_since LIMIT p_limit) t
    ),
    'sections', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM sections WHERE updated_at > p_since LIMIT p_limit) t
    ),
    'event_categories', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM event_categories WHERE updated_at > p_since LIMIT p_limit) t
    ),
    'obligation_rules', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM obligation_rules WHERE coalesce(updated_at, created_at) > p_since LIMIT p_limit) t
    ),
    'events', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM events WHERE updated_at > p_since LIMIT p_limit) t
    ),
    'event_occurrences', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM event_occurrences WHERE updated_at > p_since LIMIT p_limit) t
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
        LIMIT p_limit
      ) t
    ),
    'student_obligations', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM student_obligations 
        WHERE updated_at > p_since 
          AND (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        LIMIT p_limit
      ) t
    ),
    'payments', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (
        SELECT * FROM payments 
        WHERE (coalesce(updated_at, processed_at) > p_since)
          AND (v_role IN ('DEVADMIN', 'OFFICER') OR student_id = v_student_id)
        LIMIT p_limit
      ) t
    ),
    'payment_allocations', (
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      FROM (SELECT * FROM payment_allocations LIMIT p_limit) t
    )
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_pull_batch TO authenticated, anon;

