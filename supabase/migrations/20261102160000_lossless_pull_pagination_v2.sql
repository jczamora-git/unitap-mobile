-- ==============================================================================
-- UniTap 2.0 Forward-Only Migration: Lossless Multi-Table Pull Pagination
-- Migration: 20261102160000_lossless_pull_pagination_v2.sql
--
-- Objective:
--   Replace unsafe single global pull cursor with a reliable, role-scoped,
--   per-entity incremental pull protocol.
--
-- Architecture:
--   1. Add updated_at column to programs table for reliable incremental change tracking.
--   2. Implement versioned server RPC sync_pull_entity_v2:
--      - Explicit 18-entity allowlist
--      - Independent per-entity cursor pagination (p_since, p_last_id)
--      - Type-safe tie-breaking on identical timestamps (handling both UUID and TEXT primary keys)
--      - Deterministic has_more calculation via (limit + 1) lookahead
--      - Bounded page sizes (1 to 1000, default 500)
--      - Strict fail-closed role and scope authorization (DEVADMIN, STUDENT, OFFICER)
--      - Structured error responses for invalid entity requests
--   3. Preserves existing sync_pull_batch RPC for backward compatibility.
-- ==============================================================================

-- 1. Ensure programs table has updated_at column for uniform incremental indexing
ALTER TABLE IF EXISTS public.programs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'programs') THEN
    UPDATE public.programs SET updated_at = now() WHERE updated_at IS NULL;
  END IF;
END $$;

-- High performance composite cursor indexes for tie-breaking
CREATE INDEX IF NOT EXISTS idx_academic_years_sync_cursor ON public.academic_years(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_semesters_sync_cursor ON public.semesters(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_programs_sync_cursor ON public.programs(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_year_levels_sync_cursor ON public.year_levels(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_sections_sync_cursor ON public.sections(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_event_categories_sync_cursor ON public.event_categories(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_events_sync_cursor ON public.events(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_event_occurrences_sync_cursor ON public.event_occurrences(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_students_sync_cursor ON public.students(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_student_enrollments_sync_cursor ON public.student_enrollments(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_nfc_cards_sync_cursor ON public.nfc_cards(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_event_participants_sync_cursor ON public.event_participants(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_attendance_records_sync_cursor ON public.attendance_records(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_attendance_audit_sync_cursor ON public.attendance_audit(performed_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_obligation_rules_sync_cursor ON public.obligation_rules(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_student_obligations_sync_cursor ON public.student_obligations(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_payments_sync_cursor ON public.payments(updated_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_sync_cursor ON public.payment_allocations(created_at ASC, id ASC);

-- 2. New Versioned Independent Entity Pull RPC
CREATE OR REPLACE FUNCTION public.sync_pull_entity_v2(
  p_entity text,
  p_since timestamptz DEFAULT '1970-01-01 00:00:00+00'::timestamptz,
  p_last_id text DEFAULT NULL,
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
  v_officer_appt RECORD;
  v_officer_scope_type TEXT := NULL;
  v_officer_scope_id TEXT := NULL;
  v_clamped_limit INT := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_cursor_uuid UUID := NULL;
  v_rows JSONB := '[]'::jsonb;
  v_count INT := 0;
  v_has_more BOOLEAN := false;
  v_last_row JSONB := NULL;
  v_next_since TIMESTAMPTZ := NULL;
  v_next_last_id TEXT := NULL;
  v_ts_field TEXT := 'updated_at';
BEGIN
  -- 1. Validate entity against allowlist
  IF p_entity NOT IN (
    'academic_years', 'semesters', 'programs', 'year_levels', 'sections',
    'event_categories', 'events', 'event_occurrences', 'students',
    'student_enrollments', 'nfc_cards', 'event_participants',
    'attendance_records', 'attendance_audit', 'obligation_rules',
    'student_obligations', 'payments', 'payment_allocations'
  ) THEN
    RETURN jsonb_build_object(
      'error', 'INVALID_ENTITY',
      'message', format('Entity "%s" is not supported for synchronization.', p_entity)
    );
  END IF;

  -- 2. Fail-closed authentication
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

  -- 3. Safely populate officer appointment & scope if officer
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

  -- 4. Parse UUID cursor safely if provided
  IF p_last_id IS NOT NULL AND p_last_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_cursor_uuid := p_last_id::uuid;
  END IF;

  -- 5. Execute entity-specific query
  CASE p_entity
    WHEN 'academic_years' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT * FROM academic_years
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id)))
        ORDER BY updated_at ASC, id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'semesters' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT * FROM semesters
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id)))
        ORDER BY updated_at ASC, id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'programs' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT * FROM programs
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id)))
        ORDER BY updated_at ASC, id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'year_levels' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT * FROM year_levels
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR id > v_cursor_uuid)))
        ORDER BY updated_at ASC, id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'sections' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT * FROM sections
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR id > v_cursor_uuid)))
        ORDER BY updated_at ASC, id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'event_categories' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT * FROM event_categories
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR id > v_cursor_uuid)))
        ORDER BY updated_at ASC, id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'events' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT ev.* FROM events ev
        WHERE (ev.updated_at > p_since OR (ev.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR ev.id > v_cursor_uuid)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND ev.status IN ('ACTIVE', 'COMPLETED')) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type IN ('ORGANIZATION', 'PROGRAM', 'SECTION') OR
              (v_officer_scope_type = 'EVENT' AND ev.id::text = v_officer_scope_id)
            ))
          )
        ORDER BY ev.updated_at ASC, ev.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'event_occurrences' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT eo.* FROM event_occurrences eo
        JOIN events ev ON ev.id = eo.event_id
        WHERE (eo.updated_at > p_since OR (eo.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR eo.id > v_cursor_uuid)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND ev.status IN ('ACTIVE', 'COMPLETED')) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type IN ('ORGANIZATION', 'PROGRAM', 'SECTION') OR
              (v_officer_scope_type = 'EVENT' AND eo.event_id::text = v_officer_scope_id)
            ))
          )
        ORDER BY eo.updated_at ASC, eo.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'students' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT stu.* FROM students stu
        WHERE (stu.updated_at > p_since OR (stu.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR stu.id > v_cursor_uuid)))
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
        ORDER BY stu.updated_at ASC, stu.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'student_enrollments' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT se.* FROM student_enrollments se
        WHERE (se.updated_at > p_since OR (se.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR se.id > v_cursor_uuid)))
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
        ORDER BY se.updated_at ASC, se.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'nfc_cards' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT nc.* FROM nfc_cards nc
        WHERE (nc.updated_at > p_since OR (nc.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR nc.id > v_cursor_uuid)))
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
        ORDER BY nc.updated_at ASC, nc.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'event_participants' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT ep.* FROM event_participants ep
        JOIN event_occurrences eo ON eo.id = ep.occurrence_id
        WHERE (ep.updated_at > p_since OR (ep.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR ep.id > v_cursor_uuid)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND ep.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'EVENT' AND eo.event_id::text = v_officer_scope_id) OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = ep.student_id AND se.program_id = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'SECTION' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = ep.student_id AND se.section_id::text = v_officer_scope_id
              ))
            ))
          )
        ORDER BY ep.updated_at ASC, ep.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'attendance_records' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT ar.* FROM attendance_records ar
        JOIN event_occurrences eo ON eo.id = ar.occurrence_id
        WHERE (ar.updated_at > p_since OR (ar.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR ar.id > v_cursor_uuid)))
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

    WHEN 'attendance_audit' THEN
      v_ts_field := 'performed_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT 
          aa.id,
          aa.attendance_id,
          aa.occurrence_id,
          aa.student_id,
          aa.action,
          aa.old_status,
          aa.new_status,
          CASE WHEN v_role = 'STUDENT' THEN 'Record status update' ELSE aa.reason END AS reason,
          CASE WHEN v_role = 'STUDENT' THEN NULL ELSE aa.performed_by_user_id END AS performed_by_user_id,
          coalesce(aa.performed_at, aa.created_at) AS performed_at
        FROM attendance_audit aa
        JOIN attendance_records ar ON ar.id = aa.attendance_id
        JOIN event_occurrences eo ON eo.id = ar.occurrence_id
        WHERE (
          (coalesce(aa.performed_at, aa.created_at) > p_since) OR
          (coalesce(aa.performed_at, aa.created_at) = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR aa.id > v_cursor_uuid))
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
        ORDER BY coalesce(aa.performed_at, aa.created_at) ASC, aa.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'obligation_rules' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT obr.* FROM obligation_rules obr
        WHERE (obr.updated_at > p_since OR (obr.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR obr.id > v_cursor_uuid)))
          AND (
            v_role IN ('DEVADMIN', 'OFFICER') OR
            (v_role = 'STUDENT' AND obr.status = 'ACTIVE')
          )
        ORDER BY obr.updated_at ASC, obr.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'student_obligations' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT so.* FROM student_obligations so
        WHERE (so.updated_at > p_since OR (so.updated_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR so.id > v_cursor_uuid)))
          AND (
            v_role = 'DEVADMIN' OR
            (v_role = 'STUDENT' AND so.student_id = v_student_id) OR
            (v_role = 'OFFICER' AND (
              v_officer_scope_type = 'ORGANIZATION' OR
              (v_officer_scope_type = 'PROGRAM' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = so.student_id AND se.program_id = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'SECTION' AND EXISTS (
                SELECT 1 FROM student_enrollments se 
                WHERE se.student_id = so.student_id AND se.section_id::text = v_officer_scope_id
              )) OR
              (v_officer_scope_type = 'EVENT' AND EXISTS (
                SELECT 1 FROM event_participants ep
                JOIN event_occurrences eo ON eo.id = ep.occurrence_id
                WHERE ep.student_id = so.student_id AND eo.event_id::text = v_officer_scope_id
              ))
            ))
          )
        ORDER BY so.updated_at ASC, so.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'payments' THEN
      v_ts_field := 'updated_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT pay.* FROM payments pay
        WHERE (
          (coalesce(pay.updated_at, pay.processed_at) > p_since) OR
          (coalesce(pay.updated_at, pay.processed_at) = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR pay.id > v_cursor_uuid))
        )
        AND (
          v_role = 'DEVADMIN' OR
          (v_role = 'STUDENT' AND pay.student_id = v_student_id) OR
          (v_role = 'OFFICER' AND (
            v_officer_scope_type = 'ORGANIZATION' OR
            (v_officer_scope_type = 'PROGRAM' AND EXISTS (
              SELECT 1 FROM student_enrollments se 
              WHERE se.student_id = pay.student_id AND se.program_id = v_officer_scope_id
            )) OR
            (v_officer_scope_type = 'SECTION' AND EXISTS (
              SELECT 1 FROM student_enrollments se 
              WHERE se.student_id = pay.student_id AND se.section_id::text = v_officer_scope_id
            ))
          ))
        )
        ORDER BY coalesce(pay.updated_at, pay.processed_at) ASC, pay.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;

    WHEN 'payment_allocations' THEN
      v_ts_field := 'created_at';
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_rows FROM (
        SELECT pa.* FROM payment_allocations pa
        JOIN payments pay ON pay.id = pa.payment_id
        WHERE (
          (pa.created_at > p_since) OR
          (pa.created_at = p_since AND (p_last_id IS NULL OR v_cursor_uuid IS NULL OR pa.id > v_cursor_uuid))
        )
        AND (
          v_role = 'DEVADMIN' OR
          (v_role = 'STUDENT' AND pay.student_id = v_student_id) OR
          (v_role = 'OFFICER' AND (
            v_officer_scope_type = 'ORGANIZATION' OR
            (v_officer_scope_type = 'PROGRAM' AND EXISTS (
              SELECT 1 FROM student_enrollments se 
              WHERE se.student_id = pay.student_id AND se.program_id = v_officer_scope_id
            )) OR
            (v_officer_scope_type = 'SECTION' AND EXISTS (
              SELECT 1 FROM student_enrollments se 
              WHERE se.student_id = pay.student_id AND se.section_id::text = v_officer_scope_id
            ))
          ))
        )
        ORDER BY pa.created_at ASC, pa.id ASC
        LIMIT (v_clamped_limit + 1)
      ) t;
  END CASE;

  -- 6. Deterministic pagination & lookahead calculation
  v_count := jsonb_array_length(v_rows);
  IF v_count > v_clamped_limit THEN
    v_has_more := true;
    -- Slice off the extra +1 element
    v_rows := v_rows - (v_count - 1);
    v_last_row := v_rows->(v_clamped_limit - 1);
    v_next_since := (v_last_row->>v_ts_field)::timestamptz;
    v_next_last_id := v_last_row->>'id';
  ELSE
    v_has_more := false;
    IF v_count > 0 THEN
      v_last_row := v_rows->(v_count - 1);
      v_next_since := (v_last_row->>v_ts_field)::timestamptz;
      v_next_last_id := v_last_row->>'id';
    ELSE
      v_next_since := p_since;
      v_next_last_id := p_last_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'entity', p_entity,
    'server_time', now(),
    'records', v_rows,
    'pagination', jsonb_build_object(
      'since', p_since,
      'limit', v_clamped_limit,
      'count', jsonb_array_length(v_rows),
      'has_more', v_has_more,
      'next_since', v_next_since,
      'next_last_id', v_next_last_id
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_pull_entity_v2(text, timestamptz, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_pull_entity_v2(text, timestamptz, text, integer) TO authenticated;

