-- ==============================================================================
-- UniTap 2.0: Backend Student Roster Batch Import RPC & Audit Log
-- Migration: 20261101192000_student_roster_batch_import.sql
-- Description:
--   1. Seeds baseline academic structure (ay_2026_2027, sem_2026_2027_1, prog_bsit)
--      so imports targeting standard terms resolve without foreign key violations.
--   2. Creates import_batches and import_rows tables in Supabase PostgreSQL
--      for centralized audit logging of CSV student roster uploads.
--   3. Provides import_student_roster_batch RPC to atomically upsert students,
--      enrollments, and pending profile confirmations in a single transaction.
--   4. Secures RPC and tables with DEVADMIN/OFFICER role validation.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. SEED BASELINE ACADEMIC STRUCTURE (IF MISSING)
-- ------------------------------------------------------------------------------
INSERT INTO public.academic_years (id, label, starts_on, ends_on, status, created_at, updated_at)
VALUES ('ay_2026_2027', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE', now(), now())
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

INSERT INTO public.semesters (id, academic_year_id, term, starts_on, ends_on, status, created_at, updated_at)
VALUES ('sem_2026_2027_1', 'ay_2026_2027', 'FIRST', '2026-08-01', '2026-12-31', 'ACTIVE', now(), now())
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

INSERT INTO public.programs (id, code, name, status)
VALUES ('prog_bsit', 'BSIT', 'Bachelor of Science in Information Technology', 'ACTIVE')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

-- ------------------------------------------------------------------------------
-- 1. TABLES: import_batches & import_rows
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_batches (
  id TEXT PRIMARY KEY,
  semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  source_filename TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  imported_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'VALIDATING' CHECK(status IN ('VALIDATING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  total_rows INT NOT NULL DEFAULT 0,
  imported_rows INT NOT NULL DEFAULT 0,
  rejected_rows INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_rows (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  raw_json JSONB NOT NULL,
  result VARCHAR(20) NOT NULL CHECK(result IN ('IMPORTED', 'UPDATED', 'REJECTED', 'SKIPPED')),
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_import_batches_sem ON public.import_batches(semester_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON public.import_rows(batch_id, row_number ASC);

-- ------------------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY ON IMPORT TABLES
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers and Devadmins can view import batches" ON public.import_batches;
CREATE POLICY "Officers and Devadmins can view import batches" ON public.import_batches
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('DEVADMIN', 'OFFICER')
        AND revoked_at IS NULL
    )
  );

DROP POLICY IF EXISTS "Officers and Devadmins can view import rows" ON public.import_rows;
CREATE POLICY "Officers and Devadmins can view import rows" ON public.import_rows
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_id = auth.uid()
        AND role IN ('DEVADMIN', 'OFFICER')
        AND revoked_at IS NULL
    )
  );

-- ------------------------------------------------------------------------------
-- 3. ATOMIC STUDENT ROSTER BATCH IMPORT RPC
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_student_roster_batch(
  p_batch_id TEXT,
  p_source_filename TEXT,
  p_sha256 TEXT,
  p_semester_id TEXT,
  p_program_id TEXT,
  p_roster JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_item JSONB;
  v_school_id TEXT;
  v_first_name TEXT;
  v_middle_name TEXT;
  v_last_name TEXT;
  v_year INT;
  v_section_name TEXT;
  v_client_student_id TEXT;
  v_row_number INT;
  v_existing_student RECORD;
  v_student_id UUID;
  v_is_existing BOOLEAN;
  v_year_level_id UUID;
  v_section_id UUID;
  v_enrollment_id UUID;
  v_imported_count INT := 0;
  v_updated_count INT := 0;
  v_rejected_count INT := 0;
  v_students_result JSONB := '[]'::jsonb;
  v_errors JSONB := '[]'::jsonb;
  v_idx INT := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Security verification
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT role INTO v_role
  FROM user_roles
  WHERE user_id = v_user_id AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_role IS NULL OR v_role NOT IN ('DEVADMIN', 'OFFICER') THEN
    RAISE EXCEPTION 'Unauthorized: Only officers and devadmins can import student rosters.';
  END IF;

  -- 2. Validate / auto-provision baseline semester
  IF NOT EXISTS (SELECT 1 FROM semesters WHERE id = p_semester_id) THEN
    IF p_semester_id = 'sem_2026_2027_1' THEN
      INSERT INTO public.academic_years (id, label, starts_on, ends_on, status, created_at, updated_at)
      VALUES ('ay_2026_2027', '2026-2027', '2026-08-01', '2027-05-31', 'ACTIVE', now(), now())
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

      INSERT INTO public.semesters (id, academic_year_id, term, starts_on, ends_on, status, created_at, updated_at)
      VALUES ('sem_2026_2027_1', 'ay_2026_2027', 'FIRST', '2026-08-01', '2026-12-31', 'ACTIVE', now(), now())
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
    ELSE
      RAISE EXCEPTION 'Semester % not found.', p_semester_id;
    END IF;
  END IF;

  -- 3. Ensure baseline program exists if prog_bsit
  IF p_program_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM programs WHERE id = p_program_id) THEN
    IF p_program_id = 'prog_bsit' THEN
      INSERT INTO public.programs (id, code, name, status)
      VALUES ('prog_bsit', 'BSIT', 'Bachelor of Science in Information Technology', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
    END IF;
  END IF;

  -- 4. Log initial batch
  INSERT INTO import_batches (
    id, semester_id, source_filename, sha256, imported_by_user_id,
    imported_at, status, total_rows, imported_rows, rejected_rows,
    created_at, updated_at
  )
  VALUES (
    p_batch_id, p_semester_id, p_source_filename, p_sha256, v_user_id,
    v_now, 'VALIDATING', jsonb_array_length(p_roster), 0, 0,
    v_now, v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    updated_at = v_now;

  -- 5. Process roster elements
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_roster)
  LOOP
    v_idx := v_idx + 1;
    v_school_id := trim(v_item->>'school_id');
    v_first_name := trim(v_item->>'first_name');
    v_middle_name := nullif(trim(v_item->>'middle_name'), '');
    v_last_name := trim(v_item->>'last_name');
    v_year := coalesce((v_item->>'year')::int, 1);
    v_section_name := trim(v_item->>'section');
    v_client_student_id := v_item->>'id';
    v_row_number := coalesce((v_item->>'row_number')::int, v_idx);

    BEGIN
      IF v_school_id = '' OR v_first_name = '' OR v_last_name = '' THEN
        RAISE EXCEPTION 'Missing required student fields (school_id, first_name, last_name).';
      END IF;

      -- Check if student already exists by school_id
      SELECT id, first_name, last_name INTO v_existing_student
      FROM students
      WHERE lower(trim(school_id)) = lower(v_school_id)
      LIMIT 1;

      IF FOUND THEN
        v_student_id := v_existing_student.id;
        v_is_existing := true;
        
        UPDATE students
        SET first_name = v_first_name,
            middle_name = coalesce(v_middle_name, students.middle_name),
            last_name = v_last_name,
            updated_at = v_now
        WHERE id = v_student_id;
        
        v_updated_count := v_updated_count + 1;
      ELSE
        v_is_existing := false;
        IF v_client_student_id IS NOT NULL AND v_client_student_id ~ '^[0-9a-fA-F-]{36}$' THEN
          v_student_id := v_client_student_id::uuid;
        ELSE
          v_student_id := gen_random_uuid();
        END IF;

        INSERT INTO students (
          id, school_id, first_name, middle_name, last_name, status, created_at, updated_at
        ) VALUES (
          v_student_id, v_school_id, v_first_name, v_middle_name, v_last_name, 'ACTIVE', v_now, v_now
        );

        v_imported_count := v_imported_count + 1;
      END IF;

      -- Resolve year_level_id & section_id
      SELECT id INTO v_year_level_id
      FROM year_levels
      WHERE level_number = v_year
      LIMIT 1;

      SELECT id INTO v_section_id
      FROM sections
      WHERE lower(trim(section_name)) = lower(v_section_name)
        AND (year_level_id = v_year_level_id OR v_year_level_id IS NULL)
      LIMIT 1;

      IF v_section_id IS NULL THEN
        SELECT id INTO v_section_id
        FROM sections
        WHERE lower(trim(section_name)) = lower(v_section_name)
        LIMIT 1;
      END IF;

      -- Upsert student enrollment
      INSERT INTO student_enrollments (
        id, student_id, semester_id, program_id, year_level, section,
        year_level_id, section_id, enrollment_status,
        first_name_snapshot, middle_name_snapshot, last_name_snapshot, updated_at
      ) VALUES (
        gen_random_uuid(), v_student_id, p_semester_id, p_program_id, v_year, v_section_name,
        v_year_level_id, v_section_id, 'ENROLLED',
        v_first_name, v_middle_name, v_last_name, v_now
      )
      ON CONFLICT (student_id, semester_id) DO UPDATE SET
        program_id = EXCLUDED.program_id,
        year_level = EXCLUDED.year_level,
        section = EXCLUDED.section,
        year_level_id = EXCLUDED.year_level_id,
        section_id = EXCLUDED.section_id,
        first_name_snapshot = EXCLUDED.first_name_snapshot,
        middle_name_snapshot = EXCLUDED.middle_name_snapshot,
        last_name_snapshot = EXCLUDED.last_name_snapshot,
        updated_at = v_now
      RETURNING id INTO v_enrollment_id;

      -- Ensure default profile confirmation exists
      IF NOT EXISTS (
        SELECT 1 FROM profile_confirmations
        WHERE student_id = v_student_id AND semester_id = p_semester_id
      ) THEN
        INSERT INTO profile_confirmations (
          id, student_id, semester_id, status, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), v_student_id, p_semester_id, 'PENDING', v_now, v_now
        );
      END IF;

      -- Log row into import_rows
      INSERT INTO import_rows (
        id, batch_id, row_number, raw_json, result, student_id, error_message, created_at
      ) VALUES (
        gen_random_uuid()::text,
        p_batch_id,
        v_row_number,
        v_item,
        CASE WHEN v_is_existing THEN 'UPDATED' ELSE 'IMPORTED' END,
        v_student_id,
        null,
        v_now
      );

      -- Append to students return list
      v_students_result := v_students_result || jsonb_build_object(
        'id', v_student_id,
        'school_id', v_school_id,
        'first_name', v_first_name,
        'middle_name', v_middle_name,
        'last_name', v_last_name,
        'year', v_year,
        'section', v_section_name,
        'year_level_id', v_year_level_id,
        'section_id', v_section_id,
        'enrollment_id', v_enrollment_id,
        'is_existing', v_is_existing
      );

    EXCEPTION WHEN OTHERS THEN
      v_rejected_count := v_rejected_count + 1;
      INSERT INTO import_rows (
        id, batch_id, row_number, raw_json, result, student_id, error_message, created_at
      ) VALUES (
        gen_random_uuid()::text,
        p_batch_id,
        v_row_number,
        v_item,
        'REJECTED',
        null,
        SQLERRM,
        v_now
      );
      v_errors := v_errors || jsonb_build_object(
        'row_number', v_row_number,
        'school_id', v_school_id,
        'error', SQLERRM
      );
    END;
  END LOOP;

  -- 6. Finalize batch status
  UPDATE import_batches
  SET status = CASE WHEN v_rejected_count = 0 THEN 'COMPLETED' WHEN (v_imported_count + v_updated_count) > 0 THEN 'PARTIAL' ELSE 'FAILED' END,
      imported_rows = v_imported_count + v_updated_count,
      rejected_rows = v_rejected_count,
      updated_at = now()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'imported_count', v_imported_count,
    'updated_count', v_updated_count,
    'total_processed', v_imported_count + v_updated_count,
    'rejected_count', v_rejected_count,
    'students', v_students_result,
    'errors', v_errors
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.import_student_roster_batch(text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_student_roster_batch(text, text, text, text, text, jsonb) TO authenticated;
