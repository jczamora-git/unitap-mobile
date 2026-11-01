-- ==============================================================================
-- UniTap 2.0: Production Security Hardening & Correctness Alignment
-- Addresses all findings from UNITAP_SQL_MIGRATION_AUDIT.md:
--   C1: Revoke unsafe anon privileges and default grants
--   C2: Fail-closed role resolution in sync_pull_batch (no DEVADMIN default)
--   C3: Enforce authenticated role checks and proper dynamic column updates in sync_push_batch
--   C4: Authenticated caller containment on sync_pull_changes
--   C5: Re-establish relational integrity foreign keys with compatible TEXT IDs
--   C6: Bind activate_student_account strictly to auth.uid() and lock claim row
--   C7: Protect officer_get_student_activation_status with DEVADMIN/OFFICER role guard
--   C8: Revoke obsolete unlinked verify_and_claim_student_code
--   C9: Scope payment_allocations pull by student/officer authorization
--   C10: Enable Row Level Security (RLS) across core tables
--   H1: Dynamic payload column updates on push UPDATE
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. REVOKE DANGEROUS ANONYMOUS ACCESS (Least Privilege)
-- ------------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon;

-- Revoke obsolete legacy unauthenticated activation function
REVOKE EXECUTE ON FUNCTION public.verify_and_claim_student_code(text, text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. ENABLE ROW LEVEL SECURITY ON MISSING ENTITY TABLES (Finding C10)
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS nfc_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS attendance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profile_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sync_change_log ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 3. HARDEN STUDENT ACCOUNT ACTIVATION (Findings C6, H12)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_student_account(
  p_school_id text, 
  p_token_hash text, 
  p_auth_user_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student RECORD;
  v_claim RECORD;
  v_user_id UUID;
  v_existing_claim_user RECORD;
  v_clean_school_id TEXT;
BEGIN
  -- Strict caller verification (Finding C6): MUST match authenticated session
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required for activation.');
  END IF;

  IF p_auth_user_id IS NOT NULL AND p_auth_user_id <> v_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Caller identity mismatch: cannot activate for another user.');
  END IF;

  v_clean_school_id := trim(p_school_id);

  -- 1. Verify student exists and is ACTIVE
  SELECT * INTO v_student 
  FROM students 
  WHERE lower(school_id) = lower(v_clean_school_id) 
    AND status = 'ACTIVE';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code or school ID.');
  END IF;

  -- 2. Lock & verify student is not already claimed
  SELECT * INTO v_existing_claim_user 
  FROM users 
  WHERE student_id = v_student.id 
    AND account_status = 'ACTIVE'
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_claim_user.id = v_user_id THEN
      RETURN jsonb_build_object(
        'success', true, 
        'already_linked', true,
        'student_id', v_student.id,
        'school_id', v_student.school_id,
        'first_name', v_student.first_name,
        'last_name', v_student.last_name
      );
    ELSE
      RETURN jsonb_build_object('success', false, 'error', 'This student record has already been activated. Please sign in or contact an officer.');
    END IF;
  END IF;

  -- 3. Verify auth user is not already linked to another student
  IF EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND student_id IS NOT NULL AND student_id <> v_student.id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your account is already linked to another student record.');
  END IF;

  -- 4. Check & lock active activation claim row (Finding H12: FOR UPDATE prevents race conditions)
  SELECT * INTO v_claim 
  FROM activation_claims 
  WHERE student_id = v_student.id 
    AND used_at IS NULL 
    AND revoked_at IS NULL
  ORDER BY created_at DESC 
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No active activation code found for this student. Please request one from an officer.');
  END IF;

  -- 5. Rate limiting / attempt limit check
  IF v_claim.attempt_count >= v_claim.max_attempts THEN
    UPDATE activation_claims SET revoked_at = now() WHERE id = v_claim.id;
    INSERT INTO activation_claims_audit (claim_id, student_id, action, notes)
    VALUES (v_claim.id, v_student.id, 'REVOKED', 'Exceeded maximum failed activation attempts');
    RETURN jsonb_build_object('success', false, 'error', 'Too many failed activation attempts. Code revoked. Please request a new one from an officer.');
  END IF;

  -- 6. Check expiration
  IF v_claim.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'This activation code has expired. Please request a new one from an officer.');
  END IF;

  -- 7. Validate hash
  IF v_claim.token_hash <> p_token_hash THEN
    UPDATE activation_claims 
    SET attempt_count = attempt_count + 1, 
        last_attempt_at = now() 
    WHERE id = v_claim.id;

    INSERT INTO activation_claims_audit (claim_id, student_id, action, notes)
    VALUES (v_claim.id, v_student.id, 'ATTEMPT_FAILED', format('Incorrect token hash attempt %s of %s', v_claim.attempt_count + 1, v_claim.max_attempts));

    IF v_claim.attempt_count + 1 >= v_claim.max_attempts THEN
      UPDATE activation_claims SET revoked_at = now() WHERE id = v_claim.id;
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'Invalid activation code or school ID.');
  END IF;

  -- 8. ATOMIC SUCCESS TRANSACTION
  UPDATE activation_claims 
  SET used_at = now(), 
      claimed_by_user_id = v_user_id 
  WHERE id = v_claim.id;

  INSERT INTO users (id, username, student_id, account_status, created_at, updated_at)
  VALUES (v_user_id, lower(v_student.school_id), v_student.id, 'ACTIVE', now(), now())
  ON CONFLICT (id) DO UPDATE SET
    student_id = EXCLUDED.student_id,
    username = EXCLUDED.username,
    account_status = 'ACTIVE',
    updated_at = now();

  INSERT INTO user_roles (id, user_id, role, assigned_at)
  VALUES (gen_random_uuid(), v_user_id, 'STUDENT', now())
  ON CONFLICT DO NOTHING;

  INSERT INTO activation_claims_audit (claim_id, student_id, action, performed_by_user_id, notes)
  VALUES (v_claim.id, v_student.id, 'CLAIMED', v_user_id, 'Student self-registration completed');

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student.id,
    'school_id', v_student.school_id,
    'first_name', v_student.first_name,
    'last_name', v_student.last_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_student_account(text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_student_account(text, text, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 4. HARDEN OFFICER ACTIVATION STATUS CHECK (Finding C7)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.officer_get_student_activation_status(p_student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_user RECORD;
  v_claim RECORD;
  v_status TEXT := 'NOT_ACTIVATED';
  v_audit JSONB;
BEGIN
  -- Strict officer authorization check
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = v_caller_id 
      AND role IN ('DEVADMIN', 'OFFICER') 
      AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Officer or DevAdmin privileges required.';
  END IF;

  -- Check if already activated
  SELECT * INTO v_user FROM users WHERE student_id = p_student_id;
  IF FOUND AND v_user.account_status = 'ACTIVE' THEN
    v_status := 'ACTIVATED';
  ELSE
    SELECT * INTO v_claim 
    FROM activation_claims 
    WHERE student_id = p_student_id 
    ORDER BY created_at DESC 
    LIMIT 1;

    IF FOUND THEN
      IF v_claim.revoked_at IS NOT NULL OR v_claim.attempt_count >= v_claim.max_attempts THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSIF v_claim.used_at IS NOT NULL THEN
        v_status := 'ACTIVATED';
      ELSIF v_claim.expires_at < now() THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSE
        v_status := 'ACTIVATION_PENDING';
      END IF;
    ELSE
      v_status := 'NOT_ACTIVATED';
    END IF;
  END IF;

  -- Load audit trail
  SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT action, performed_by_user_id, notes, created_at 
    FROM activation_claims_audit 
    WHERE student_id = p_student_id 
    ORDER BY created_at DESC 
    LIMIT 10
  ) a;

  RETURN jsonb_build_object(
    'status', v_status,
    'student_id', p_student_id,
    'claim_id', v_claim.id,
    'expires_at', v_claim.expires_at,
    'attempt_count', v_claim.attempt_count,
    'max_attempts', v_claim.max_attempts,
    'linked_user_id', v_user.id,
    'linked_username', v_user.username,
    'audit_history', v_audit
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.officer_get_student_activation_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.officer_get_student_activation_status(uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. HARDEN SYNC PULL BATCH (Findings C2, C9, H4)
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
  -- Strict authentication check: Fail-closed (Finding C2)
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

  -- Build aggregated JSON payload in 1 single transaction
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
-- 6. HARDEN SYNC PUSH BATCH (Findings C3, H1, H2)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_push_batch(p_operations jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_role TEXT;
  v_op JSONB;
  v_table_name TEXT;
  v_operation TEXT;
  v_payload JSONB;
  v_entity_id TEXT;
  v_outbox_id TEXT;
  v_results JSONB := '[]'::jsonb;
  v_applied INT := 0;
  v_failed INT := 0;
  v_updates TEXT;
BEGIN
  -- Strict caller verification (Finding C3)
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

  -- Students are strictly forbidden from modifying master/administrative data
  IF v_role = 'STUDENT' THEN
    RAISE EXCEPTION 'Unauthorized: Student role cannot push administrative records.';
  END IF;

  IF p_operations IS NULL OR jsonb_array_length(p_operations) = 0 THEN
    RETURN jsonb_build_object('success', true, 'applied_count', 0, 'failed_count', 0, 'results', '[]'::jsonb);
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
        -- Safely populate row from jsonb and insert
        EXECUTE format(
          'INSERT INTO %I SELECT * FROM jsonb_populate_record(null::%I, %L) ON CONFLICT (id) DO NOTHING',
          v_table_name, v_table_name, v_payload
        );
      ELSIF v_operation = 'UPDATE' THEN
        -- Dynamic column update from json payload (Finding H1)
        SELECT string_agg(quote_ident(key) || ' = ' || quote_nullable(value), ', ')
        INTO v_updates
        FROM jsonb_each_text(v_payload)
        WHERE key NOT IN ('id');

        IF v_updates IS NOT NULL AND v_updates <> '' THEN
          EXECUTE format(
            'UPDATE %I SET %s WHERE id = %L',
            v_table_name, v_updates, v_entity_id
          );
        ELSE
          EXECUTE format(
            'UPDATE %I SET updated_at = now() WHERE id = %L',
            v_table_name, v_entity_id
          );
        END IF;
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
    'success', (v_failed = 0),
    'applied_count', v_applied,
    'failed_count', v_failed,
    'results', v_results
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_push_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_push_batch(jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. HARDEN SYNC PULL CHANGES (Finding C4)
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.sync_pull_changes(bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_pull_changes(bigint, integer) TO authenticated;

-- ------------------------------------------------------------------------------
-- 8. RE-ESTABLISH RELATIONAL INTEGRITY FOREIGN KEYS (Finding C5)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  -- sections -> academic_years
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sections_academic_year_id_fkey' AND table_schema = 'public') THEN
    BEGIN
      ALTER TABLE sections ADD CONSTRAINT sections_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add sections_academic_year_id_fkey: %', SQLERRM;
    END;
  END IF;

  -- sections -> programs
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'sections_program_id_fkey' AND table_schema = 'public') THEN
    BEGIN
      ALTER TABLE sections ADD CONSTRAINT sections_program_id_fkey FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add sections_program_id_fkey: %', SQLERRM;
    END;
  END IF;

  -- semesters -> academic_years
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'semesters_academic_year_id_fkey' AND table_schema = 'public') THEN
    BEGIN
      ALTER TABLE semesters ADD CONSTRAINT semesters_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add semesters_academic_year_id_fkey: %', SQLERRM;
    END;
  END IF;

  -- obligation_rules -> semesters
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'obligation_rules_semester_id_fkey' AND table_schema = 'public') THEN
    BEGIN
      ALTER TABLE obligation_rules ADD CONSTRAINT obligation_rules_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add obligation_rules_semester_id_fkey: %', SQLERRM;
    END;
  END IF;

  -- student_enrollments -> academic_years
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'student_enrollments_academic_year_id_fkey' AND table_schema = 'public') THEN
    BEGIN
      ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE RESTRICT;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add student_enrollments_academic_year_id_fkey: %', SQLERRM;
    END;
  END IF;

  -- student_enrollments -> semesters
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'student_enrollments_semester_id_fkey' AND table_schema = 'public') THEN
    BEGIN
      ALTER TABLE student_enrollments ADD CONSTRAINT student_enrollments_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE RESTRICT;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add student_enrollments_semester_id_fkey: %', SQLERRM;
    END;
  END IF;

  -- student_obligations -> semesters
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'student_obligations_semester_id_fkey' AND table_schema = 'public') THEN
    BEGIN
      ALTER TABLE student_obligations ADD CONSTRAINT student_obligations_semester_id_fkey FOREIGN KEY (semester_id) REFERENCES semesters(id) ON DELETE CASCADE;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not add student_obligations_semester_id_fkey: %', SQLERRM;
    END;
  END IF;
END $$;
