-- ==============================================================================
-- UniTap 2.0 Forward-Only Migration: Repair sync_pull_batch Runtime Error
-- Migration: 20261102143000_repair_sync_pull_batch_type_mismatch.sql
--
-- Objective:
--   Repair PostgreSQL SQLSTATE 42883 ('operator does not exist: uuid > text')
--   in public.sync_pull_batch(timestamptz, integer, uuid).
--
-- Root Cause:
--   In migration 20261101201500, the year_levels pagination subquery erroneously
--   cast the UUID parameter p_last_id to text: (id > p_last_id::text).
--   Because year_levels.id is of type UUID, PostgreSQL threw operator 42883.
--
-- Scope:
--   - PostgreSQL RPC type compatibility ONLY.
--   - Preserves exact 3-argument function signature, return contract, permissions,
--     and SECURITY DEFINER attribute.
--   - No DROP FUNCTION executed (preserves dependent objects).
--
-- Architecture Notice:
--   The shared multi-table pagination cursor defect (single cursor applied across
--   multiple heterogenous tables) remains unresolved in this repair and is
--   formally scheduled for remediation in Task 3.
-- ==============================================================================

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
        WHERE (updated_at > p_since OR (updated_at = p_since AND (p_last_id IS NULL OR id > p_last_id)))
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

