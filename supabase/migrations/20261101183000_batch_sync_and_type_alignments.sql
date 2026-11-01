-- ============================================================================
-- UniTap 2.0 Batch RPC Synchronization & Schema Alignment Migration
-- File: supabase/migrations/20261101183000_batch_sync_and_type_alignments.sql
-- TARGET ENGINE: Supabase PostgreSQL
-- ============================================================================

-- 1. Schema Adaptations for Hybrid Identifiers (Safe & Idempotent)

-- 1.1 Drop expression index on sections first to prevent COALESCE text vs uuid mismatch
DROP INDEX IF EXISTS idx_sections_scope_unique;

-- 1.2 Dynamically drop ALL foreign key constraints in public schema referencing academic_years, programs, or semesters
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT tc.table_schema, tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name IN ('academic_years', 'programs', 'semesters')
      AND tc.table_schema = 'public'
  ) LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', r.table_schema, r.table_name, r.constraint_name);
  END LOOP;
END $$;

-- Explicitly ensure known foreign keys are dropped (safe if table or constraint does not exist)
ALTER TABLE IF EXISTS sections DROP CONSTRAINT IF EXISTS sections_academic_year_id_fkey;
ALTER TABLE IF EXISTS sections DROP CONSTRAINT IF EXISTS sections_program_id_fkey;
ALTER TABLE IF EXISTS semesters DROP CONSTRAINT IF EXISTS semesters_academic_year_id_fkey;
ALTER TABLE IF EXISTS student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_program_id_fkey;
ALTER TABLE IF EXISTS student_enrollments DROP CONSTRAINT IF EXISTS student_enrollments_semester_id_fkey;
ALTER TABLE IF EXISTS profile_confirmations DROP CONSTRAINT IF EXISTS profile_confirmations_semester_id_fkey;
ALTER TABLE IF EXISTS user_roles DROP CONSTRAINT IF EXISTS user_roles_semester_id_fkey;
ALTER TABLE IF EXISTS events DROP CONSTRAINT IF EXISTS events_semester_id_fkey;
ALTER TABLE IF EXISTS obligation_rules DROP CONSTRAINT IF EXISTS obligation_rules_semester_id_fkey;
ALTER TABLE IF EXISTS student_obligations DROP CONSTRAINT IF EXISTS student_obligations_semester_id_fkey;
ALTER TABLE IF EXISTS payments DROP CONSTRAINT IF EXISTS payments_semester_id_fkey;
ALTER TABLE IF EXISTS officer_appointments DROP CONSTRAINT IF EXISTS officer_appointments_academic_year_id_fkey;
ALTER TABLE IF EXISTS officer_appointments DROP CONSTRAINT IF EXISTS officer_appointments_semester_id_fkey;

-- 1.3 Relax ID columns to TEXT to allow semantic string IDs (e.g. 'ay_2026_2027', 'prog_bsit')
ALTER TABLE IF EXISTS sections ALTER COLUMN academic_year_id TYPE TEXT;
ALTER TABLE IF EXISTS sections ALTER COLUMN program_id TYPE TEXT;
ALTER TABLE IF EXISTS academic_years ALTER COLUMN id TYPE TEXT;
ALTER TABLE IF EXISTS programs ALTER COLUMN id TYPE TEXT;
ALTER TABLE IF EXISTS semesters ALTER COLUMN id TYPE TEXT;
ALTER TABLE IF EXISTS semesters ALTER COLUMN academic_year_id TYPE TEXT;

ALTER TABLE IF EXISTS user_roles ALTER COLUMN semester_id TYPE TEXT;
ALTER TABLE IF EXISTS student_enrollments ALTER COLUMN program_id TYPE TEXT;
ALTER TABLE IF EXISTS student_enrollments ALTER COLUMN semester_id TYPE TEXT;
ALTER TABLE IF EXISTS profile_confirmations ALTER COLUMN semester_id TYPE TEXT;
ALTER TABLE IF EXISTS events ALTER COLUMN semester_id TYPE TEXT;
ALTER TABLE IF EXISTS obligation_rules ALTER COLUMN semester_id TYPE TEXT;
ALTER TABLE IF EXISTS student_obligations ALTER COLUMN semester_id TYPE TEXT;
ALTER TABLE IF EXISTS payments ALTER COLUMN semester_id TYPE TEXT;
ALTER TABLE IF EXISTS officer_appointments ALTER COLUMN academic_year_id TYPE TEXT;
ALTER TABLE IF EXISTS officer_appointments ALTER COLUMN semester_id TYPE TEXT;

-- 1.4 Recreate sections scope index with text-compatible COALESCE defaults
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sections') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_scope_unique
    ON sections(
      lower(trim(section_name)),
      year_level_id,
      coalesce(program_id, ''),
      coalesce(academic_year_id, '')
    );
  END IF;
END $$;

-- 1.5 Add updated_at column to payments table for uniform incremental timestamp indexing
ALTER TABLE IF EXISTS payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
    UPDATE payments SET updated_at = processed_at WHERE updated_at IS NULL;
  END IF;
END $$;

-- 2. Base Grants for PostgREST Access
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated;

-- 3. Batch Pull RPC Endpoint (Single Request for All Tables)
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
      FROM (SELECT * FROM obligation_rules WHERE updated_at > p_since LIMIT p_limit) t
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

-- 4. Batch Push RPC Endpoint (Atomic Ingestion of Outbox Operations)
CREATE OR REPLACE FUNCTION sync_push_batch(
  p_operations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op JSONB;
  v_table_name TEXT;
  v_operation TEXT;
  v_payload JSONB;
  v_entity_id TEXT;
  v_outbox_id TEXT;
  v_results JSONB := '[]'::jsonb;
  v_applied INT := 0;
  v_failed INT := 0;
BEGIN
  IF p_operations IS NULL OR jsonb_array_length(p_operations) = 0 THEN
    RETURN jsonb_build_object('success', true, 'applied_count', 0, 'results', '[]'::jsonb);
  END IF;

  FOR v_op IN SELECT * FROM jsonb_array_elements(p_operations)
  LOOP
    v_outbox_id := v_op->>'id';
    v_operation := v_op->>'operation';
    v_payload   := v_op->'payload';
    v_entity_id := v_op->>'entity_id';
    
    -- Map entity type to table name
    v_table_name := CASE v_op->>'entity_type'
      WHEN 'ATTENDANCE' THEN 'attendance_records'
      WHEN 'ATTENDANCE_ATTEMPT' THEN 'attendance_attempts'
      WHEN 'ATTENDANCE_VOID' THEN 'attendance_audit'
      WHEN 'OBLIGATION' THEN 'student_obligations'
      WHEN 'OBLIGATION_RULE' THEN 'obligation_rules'
      WHEN 'PAYMENT' THEN 'payments'
      WHEN 'PAYMENT_ALLOCATION' THEN 'payment_allocations'
      WHEN 'STUDENT' THEN 'students'
      WHEN 'ENROLLMENT' THEN 'student_enrollments'
      WHEN 'CARD' THEN 'nfc_cards'
      WHEN 'EVENT' THEN 'events'
      WHEN 'EVENT_CATEGORY' THEN 'event_categories'
      WHEN 'YEAR_LEVEL' THEN 'year_levels'
      WHEN 'SECTION' THEN 'sections'
      WHEN 'ACADEMIC_YEAR' THEN 'academic_years'
      WHEN 'SEMESTER' THEN 'semesters'
      WHEN 'OCCURRENCE' THEN 'event_occurrences'
      WHEN 'PARTICIPANT' THEN 'event_participants'
      ELSE lower(v_op->>'entity_type') || 's'
    END;

    BEGIN
      IF v_operation = 'CREATE' THEN
        EXECUTE format(
          'INSERT INTO %I SELECT * FROM jsonb_populate_record(null::%I, %L) ON CONFLICT (id) DO UPDATE SET updated_at = now()',
          v_table_name, v_table_name, v_payload
        );
      ELSIF v_operation = 'UPDATE' THEN
        EXECUTE format(
          'UPDATE %I SET updated_at = now() WHERE id = %L',
          v_table_name, v_entity_id
        );
      ELSIF v_operation IN ('VOID', 'REVOKE') THEN
        EXECUTE format(
          'UPDATE %I SET status = %L, updated_at = now() WHERE id = %L',
          v_table_name, v_operation, v_entity_id
        );
      END IF;

      v_applied := v_applied + 1;
      v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'APPLIED');
    EXCEPTION WHEN unique_violation THEN
      v_applied := v_applied + 1;
      v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'COLLISION_AUDITED');
    WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('id', v_outbox_id, 'status', 'ERROR', 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'applied_count', v_applied,
    'failed_count', v_failed,
    'results', v_results
  );
END;
$$;

-- 5. Execution Grants
GRANT EXECUTE ON FUNCTION sync_pull_batch TO authenticated, anon;
GRANT EXECUTE ON FUNCTION sync_push_batch TO authenticated, anon;

