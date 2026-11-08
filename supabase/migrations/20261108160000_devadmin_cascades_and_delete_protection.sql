-- ==============================================================================
-- Migration: 20261108160000_devadmin_cascades_and_delete_protection.sql
-- Description:
--   UniTap 2.0 DEVADMIN-Only Deletion & Cascading Child Record Cleanup Architecture:
--   1. Reconfigures Foreign Key CASCADE from obligation_rules to student_obligations
--      with a strict orphan-record precondition check (never silently deletes records).
--   2. Provides a secure SECURITY DEFINER helper public.get_current_user_student_id()
--      replacing direct public.users subqueries across student-scoped RLS policies.
--   3. Enforces Financial Immutability & Deletion Protection via hardened triggers:
--      - Prevents deleting obligation_rules if payment allocations exist.
--      - Prevents deleting student_obligations if payment allocations exist.
--      - Prevents deleting events / occurrences if paid absence fines exist;
--        cleans up unpaid operational absence fines without payment allocations.
--      - Prevents deleting students if financial payments or allocations exist.
--      - Prevents deleting academic_years or semesters if recorded payments exist.
--      - Prevents deleting programs, sections, or event_categories if active references exist.
--   4. Eliminates permissive FOR ALL policies and restricts DELETE privileges strictly
--      to DEVADMIN while preserving legitimate SELECT, INSERT, UPDATE across modules:
--      - students, student_enrollments, nfc_cards
--      - obligation_rules, student_obligations
--      - events, event_occurrences
--      - programs, sections, academic_years, semesters, event_categories
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. FOREIGN KEY CASCADE CONFIGURATION WITH ORPHAN PRECONDITION
-- ------------------------------------------------------------------------------

-- 1.1. Precondition Check: Detect orphaned student obligations referencing non-existent rules
DO $$
DECLARE
  v_orphan_count INT;
BEGIN
  SELECT COUNT(*)
  INTO v_orphan_count
  FROM public.student_obligations so
  WHERE so.rule_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.obligation_rules r WHERE r.id = so.rule_id
    );

  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION 'Precondition Failed: Found % orphaned student_obligations referencing non-existent obligation_rules. Resolve orphans before applying this migration.', v_orphan_count;
  END IF;
END $$;

-- 1.2. Recreate student_obligations -> obligation_rules FK with ON DELETE CASCADE
ALTER TABLE public.student_obligations
  DROP CONSTRAINT IF EXISTS student_obligations_rule_id_fkey;

ALTER TABLE public.student_obligations
  ADD CONSTRAINT student_obligations_rule_id_fkey
  FOREIGN KEY (rule_id)
  REFERENCES public.obligation_rules(id)
  ON DELETE CASCADE;

-- ------------------------------------------------------------------------------
-- 2. SECURITY DEFINER HELPER FUNCTIONS
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_current_user_student_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT u.student_id
  FROM public.users u
  WHERE u.id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_current_user_student_id() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_student_id() TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. HARDENED FINANCIAL INTEGRITY & DELETION PROTECTION TRIGGERS
-- ------------------------------------------------------------------------------

-- 3.1. Obligation Rules: Protect against deleting collections that have payments
CREATE OR REPLACE FUNCTION public.trg_protect_obligation_rule_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_payments BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.student_obligations so
    JOIN public.payment_allocations pa ON pa.obligation_id = so.id
    WHERE so.rule_id = OLD.id
  ) INTO v_has_payments;

  IF v_has_payments THEN
    RAISE EXCEPTION 'Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate the rule instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_obligation_rule_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_obligation_rule_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_obligation_rule_deletion ON public.obligation_rules;
CREATE TRIGGER trg_protect_obligation_rule_deletion
  BEFORE DELETE ON public.obligation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_obligation_rule_deletion();

-- 3.2. Student Obligations: Protect against deleting obligations that have payments
CREATE OR REPLACE FUNCTION public.trg_protect_student_obligation_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_payments BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.payment_allocations pa
    WHERE pa.obligation_id = OLD.id
  ) INTO v_has_payments;

  IF v_has_payments THEN
    RAISE EXCEPTION 'Cannot delete student obligation because payments have already been allocated to it. Reversal or adjustment is required.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_student_obligation_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_student_obligation_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_student_obligation_deletion ON public.student_obligations;
CREATE TRIGGER trg_protect_student_obligation_deletion
  BEFORE DELETE ON public.student_obligations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_student_obligation_deletion();

-- 3.3. Events & Event Occurrences: Protect against deleting events/occurrences with paid absence fines; cleanup unpaid operational absence fines
CREATE OR REPLACE FUNCTION public.trg_protect_event_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_paid_fines BOOLEAN;
BEGIN
  -- Check if paid or partially paid absence fines exist for this event or any of its occurrences
  SELECT EXISTS (
    SELECT 1
    FROM public.student_obligations so
    JOIN public.payment_allocations pa ON pa.obligation_id = so.id
    WHERE (
      so.related_event_id = OLD.id
      OR so.related_occurrence_id IN (
        SELECT eo.id FROM public.event_occurrences eo WHERE eo.event_id = OLD.id
      )
    )
  ) INTO v_has_paid_fines;

  IF v_has_paid_fines THEN
    RAISE EXCEPTION 'Cannot delete event because paid absence fines are associated with it. Please archive or deactivate the event instead.';
  END IF;

  -- Clean up only unpaid operational absence fines (without payment allocations) associated with the event
  DELETE FROM public.student_obligations so
  WHERE (
    so.related_event_id = OLD.id
    OR so.related_occurrence_id IN (
      SELECT eo.id FROM public.event_occurrences eo WHERE eo.event_id = OLD.id
    )
  )
  AND so.id NOT IN (SELECT pa.obligation_id FROM public.payment_allocations pa);

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_event_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_event_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_event_deletion ON public.events;
CREATE TRIGGER trg_protect_event_deletion
  BEFORE DELETE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_event_deletion();

CREATE OR REPLACE FUNCTION public.trg_protect_event_occurrence_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_paid_fines BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.student_obligations so
    JOIN public.payment_allocations pa ON pa.obligation_id = so.id
    WHERE so.related_occurrence_id = OLD.id
  ) INTO v_has_paid_fines;

  IF v_has_paid_fines THEN
    RAISE EXCEPTION 'Cannot delete event occurrence because paid absence fines are associated with it. Please archive or deactivate instead.';
  END IF;

  -- Clean up only unpaid operational absence fines associated with this occurrence
  DELETE FROM public.student_obligations so
  WHERE so.related_occurrence_id = OLD.id
    AND so.id NOT IN (SELECT pa.obligation_id FROM public.payment_allocations pa);

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_event_occurrence_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_event_occurrence_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_event_occurrence_deletion ON public.event_occurrences;
CREATE TRIGGER trg_protect_event_occurrence_deletion
  BEFORE DELETE ON public.event_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_event_occurrence_deletion();

-- 3.4. Students: Protect against deleting students with recorded payments
CREATE OR REPLACE FUNCTION public.trg_protect_student_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_financial_history BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.payments p WHERE p.student_id = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM public.student_obligations so
    JOIN public.payment_allocations pa ON pa.obligation_id = so.id
    WHERE so.student_id = OLD.id
  ) INTO v_has_financial_history;

  IF v_has_financial_history THEN
    RAISE EXCEPTION 'Cannot delete student because financial payments or allocations exist. Deactivate the student record instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_student_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_student_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_student_deletion ON public.students;
CREATE TRIGGER trg_protect_student_deletion
  BEFORE DELETE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_student_deletion();

-- 3.5. Academic Years & Semesters: Protect against deleting periods with recorded payments
CREATE OR REPLACE FUNCTION public.trg_protect_academic_year_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_payments BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.payments p
    JOIN public.semesters s ON s.id = p.semester_id
    WHERE s.academic_year_id = OLD.id
  ) INTO v_has_payments;

  IF v_has_payments THEN
    RAISE EXCEPTION 'Cannot delete academic year because financial payment records are associated with its semesters. Deactivate instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_academic_year_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_academic_year_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_academic_year_deletion ON public.academic_years;
CREATE TRIGGER trg_protect_academic_year_deletion
  BEFORE DELETE ON public.academic_years
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_academic_year_deletion();

CREATE OR REPLACE FUNCTION public.trg_protect_semester_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_payments BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.payments p WHERE p.semester_id = OLD.id
  ) INTO v_has_payments;

  IF v_has_payments THEN
    RAISE EXCEPTION 'Cannot delete semester because financial payment records are associated with it. Deactivate instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_semester_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_semester_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_semester_deletion ON public.semesters;
CREATE TRIGGER trg_protect_semester_deletion
  BEFORE DELETE ON public.semesters
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_semester_deletion();

-- 3.6. Programs, Sections, Event Categories: Protect against deleting referenced parents
CREATE OR REPLACE FUNCTION public.trg_protect_program_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_enrollments BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.student_enrollments se WHERE se.program_id = OLD.id
  ) INTO v_has_enrollments;

  IF v_has_enrollments THEN
    RAISE EXCEPTION 'Cannot delete program because student enrollments are associated with it. Reassign enrollments or deactivate the program instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_program_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_program_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_program_deletion ON public.programs;
CREATE TRIGGER trg_protect_program_deletion
  BEFORE DELETE ON public.programs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_program_deletion();

CREATE OR REPLACE FUNCTION public.trg_protect_section_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_enrollments BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.student_enrollments se WHERE se.section_id = OLD.id
  ) INTO v_has_enrollments;

  IF v_has_enrollments THEN
    RAISE EXCEPTION 'Cannot delete section because student enrollments are associated with it. Reassign enrollments or deactivate the section instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_section_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_section_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_section_deletion ON public.sections;
CREATE TRIGGER trg_protect_section_deletion
  BEFORE DELETE ON public.sections
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_section_deletion();

CREATE OR REPLACE FUNCTION public.trg_protect_event_category_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_events BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.events e WHERE e.category_id = OLD.id
  ) INTO v_has_events;

  IF v_has_events THEN
    RAISE EXCEPTION 'Cannot delete event category because events are associated with it. Reassign event categories or deactivate instead.';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_event_category_deletion() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_event_category_deletion() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_event_category_deletion ON public.event_categories;
CREATE TRIGGER trg_protect_event_category_deletion
  BEFORE DELETE ON public.event_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_event_category_deletion();

-- ------------------------------------------------------------------------------
-- 4. DEVADMIN-ONLY DELETE ROW LEVEL SECURITY (RLS) POLICIES
--    (Removes all permissive FOR ALL policies to ensure DELETE is never bypassed)
-- ------------------------------------------------------------------------------

-- 4.1. STUDENTS: Officers/DevAdmin can SELECT, INSERT, UPDATE. Student can SELECT own. DEVADMIN ONLY can DELETE.
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage all students" ON public.students;
DROP POLICY IF EXISTS "Officers read all students" ON public.students;
DROP POLICY IF EXISTS "Students read own profile" ON public.students;
DROP POLICY IF EXISTS "Students select authorized" ON public.students;
DROP POLICY IF EXISTS "Students insert authorized" ON public.students;
DROP POLICY IF EXISTS "Students update authorized" ON public.students;
DROP POLICY IF EXISTS "Students delete authorized" ON public.students;

CREATE POLICY "Students select authorized" ON public.students
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR id = public.get_current_user_student_id()
  );

CREATE POLICY "Students insert authorized" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY "Students update authorized" ON public.students
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY "Students delete authorized" ON public.students
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.2. STUDENT ENROLLMENTS: Officers/DevAdmin can SELECT, INSERT, UPDATE. Student can SELECT own. DEVADMIN ONLY can DELETE.
ALTER TABLE public.student_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage enrollments" ON public.student_enrollments;
DROP POLICY IF EXISTS "Students read own enrollments" ON public.student_enrollments;
DROP POLICY IF EXISTS "Enrollments select authorized" ON public.student_enrollments;
DROP POLICY IF EXISTS "Enrollments insert authorized" ON public.student_enrollments;
DROP POLICY IF EXISTS "Enrollments update authorized" ON public.student_enrollments;
DROP POLICY IF EXISTS "Enrollments delete authorized" ON public.student_enrollments;

CREATE POLICY "Enrollments select authorized" ON public.student_enrollments
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR student_id = public.get_current_user_student_id()
  );

CREATE POLICY "Enrollments insert authorized" ON public.student_enrollments
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY "Enrollments update authorized" ON public.student_enrollments
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY "Enrollments delete authorized" ON public.student_enrollments
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.3. NFC CARDS: Officers/DevAdmin can SELECT, INSERT, UPDATE. Student can SELECT own. DEVADMIN ONLY can DELETE.
ALTER TABLE public.nfc_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage NFC cards" ON public.nfc_cards;
DROP POLICY IF EXISTS "Students read own NFC cards" ON public.nfc_cards;
DROP POLICY IF EXISTS "Nfc cards select authorized" ON public.nfc_cards;
DROP POLICY IF EXISTS "Nfc cards insert authorized" ON public.nfc_cards;
DROP POLICY IF EXISTS "Nfc cards update authorized" ON public.nfc_cards;
DROP POLICY IF EXISTS "Nfc cards delete authorized" ON public.nfc_cards;

CREATE POLICY "Nfc cards select authorized" ON public.nfc_cards
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR student_id = public.get_current_user_student_id()
  );

CREATE POLICY "Nfc cards insert authorized" ON public.nfc_cards
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY "Nfc cards update authorized" ON public.nfc_cards
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY "Nfc cards delete authorized" ON public.nfc_cards
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.4. OBLIGATION RULES: Officers/DevAdmin can SELECT, INSERT, UPDATE. DEVADMIN ONLY can DELETE.
ALTER TABLE public.obligation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS obligation_rules_officer_devadmin ON public.obligation_rules;
DROP POLICY IF EXISTS obligation_rules_read_all ON public.obligation_rules;
DROP POLICY IF EXISTS obligation_rules_select_authorized ON public.obligation_rules;
DROP POLICY IF EXISTS obligation_rules_insert_authorized ON public.obligation_rules;
DROP POLICY IF EXISTS obligation_rules_update_authorized ON public.obligation_rules;
DROP POLICY IF EXISTS obligation_rules_delete_authorized ON public.obligation_rules;

CREATE POLICY obligation_rules_select_authorized ON public.obligation_rules
  FOR SELECT TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER') OR status = 'ACTIVE');

CREATE POLICY obligation_rules_insert_authorized ON public.obligation_rules
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY obligation_rules_update_authorized ON public.obligation_rules
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY obligation_rules_delete_authorized ON public.obligation_rules
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.5. STUDENT OBLIGATIONS: Officers/DevAdmin can SELECT, INSERT, UPDATE. Student can SELECT own. DEVADMIN ONLY can DELETE.
ALTER TABLE public.student_obligations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage student obligations" ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_officer_devadmin ON public.student_obligations;
DROP POLICY IF EXISTS "Students read own obligations" ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_read_own ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_select_authorized ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_insert_authorized ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_update_authorized ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_delete_authorized ON public.student_obligations;

CREATE POLICY student_obligations_select_authorized ON public.student_obligations
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR student_id = public.get_current_user_student_id()
  );

CREATE POLICY student_obligations_insert_authorized ON public.student_obligations
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY student_obligations_update_authorized ON public.student_obligations
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY student_obligations_delete_authorized ON public.student_obligations
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.6. EVENTS & EVENT OCCURRENCES: DEVADMIN ONLY can DELETE. (Select, Insert, Update preserved from 20261108130000)
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS events_delete_authorized ON public.events;
CREATE POLICY events_delete_authorized ON public.events
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

DROP POLICY IF EXISTS event_occurrences_delete_authorized ON public.event_occurrences;
CREATE POLICY event_occurrences_delete_authorized ON public.event_occurrences
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.7. PROGRAMS: Authenticated can SELECT. DEVADMIN can INSERT, UPDATE, DELETE.
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS programs_select_authenticated ON public.programs;
DROP POLICY IF EXISTS programs_insert_authorized ON public.programs;
DROP POLICY IF EXISTS programs_update_authorized ON public.programs;
DROP POLICY IF EXISTS programs_delete_authorized ON public.programs;
DROP POLICY IF EXISTS programs_devadmin_manage ON public.programs;
DROP POLICY IF EXISTS "Programs devadmin manage" ON public.programs;
DROP POLICY IF EXISTS "Programs read all" ON public.programs;

CREATE POLICY programs_select_authenticated ON public.programs
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY programs_insert_authorized ON public.programs
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY programs_update_authorized ON public.programs
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN')
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY programs_delete_authorized ON public.programs
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.8. SECTIONS: Authenticated can SELECT. DEVADMIN can INSERT, UPDATE, DELETE.
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sections_devadmin_all ON public.sections;
DROP POLICY IF EXISTS sections_select_authenticated ON public.sections;
DROP POLICY IF EXISTS sections_insert_authorized ON public.sections;
DROP POLICY IF EXISTS sections_update_authorized ON public.sections;
DROP POLICY IF EXISTS sections_delete_authorized ON public.sections;
DROP POLICY IF EXISTS "Sections read all" ON public.sections;

CREATE POLICY sections_select_authenticated ON public.sections
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sections_insert_authorized ON public.sections
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY sections_update_authorized ON public.sections
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN')
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY sections_delete_authorized ON public.sections
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.9. EVENT CATEGORIES: Authenticated can SELECT. DEVADMIN can INSERT, UPDATE, DELETE.
ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_categories_devadmin_all ON public.event_categories;
DROP POLICY IF EXISTS event_categories_select_authenticated ON public.event_categories;
DROP POLICY IF EXISTS event_categories_insert_authorized ON public.event_categories;
DROP POLICY IF EXISTS event_categories_update_authorized ON public.event_categories;
DROP POLICY IF EXISTS event_categories_delete_authorized ON public.event_categories;
DROP POLICY IF EXISTS "Event categories read all" ON public.event_categories;

CREATE POLICY event_categories_select_authenticated ON public.event_categories
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY event_categories_insert_authorized ON public.event_categories
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY event_categories_update_authorized ON public.event_categories
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN')
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY event_categories_delete_authorized ON public.event_categories
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.10. ACADEMIC YEARS: Authenticated can SELECT. DEVADMIN can INSERT, UPDATE, DELETE.
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_years_devadmin_all ON public.academic_years;
DROP POLICY IF EXISTS academic_years_officer_read ON public.academic_years;
DROP POLICY IF EXISTS academic_years_select_authenticated ON public.academic_years;
DROP POLICY IF EXISTS academic_years_insert_authorized ON public.academic_years;
DROP POLICY IF EXISTS academic_years_update_authorized ON public.academic_years;
DROP POLICY IF EXISTS academic_years_delete_authorized ON public.academic_years;

CREATE POLICY academic_years_select_authenticated ON public.academic_years
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY academic_years_insert_authorized ON public.academic_years
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY academic_years_update_authorized ON public.academic_years
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN')
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY academic_years_delete_authorized ON public.academic_years
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 4.11. SEMESTERS: Authenticated can SELECT. DEVADMIN can INSERT, UPDATE, DELETE.
ALTER TABLE public.semesters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS semesters_devadmin_all ON public.semesters;
DROP POLICY IF EXISTS semesters_officer_read ON public.semesters;
DROP POLICY IF EXISTS semesters_select_authenticated ON public.semesters;
DROP POLICY IF EXISTS semesters_insert_authorized ON public.semesters;
DROP POLICY IF EXISTS semesters_update_authorized ON public.semesters;
DROP POLICY IF EXISTS semesters_delete_authorized ON public.semesters;

CREATE POLICY semesters_select_authenticated ON public.semesters
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY semesters_insert_authorized ON public.semesters
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY semesters_update_authorized ON public.semesters
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN')
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

CREATE POLICY semesters_delete_authorized ON public.semesters
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- ------------------------------------------------------------------------------
-- 5. IMMUTABLE FINANCIAL & AUDIT HISTORY ENFORCEMENT
--    (Eliminates legacy FOR ALL policies on ledger and audit records;
--     Enforces strict database-level prevention of DELETE operations)
-- ------------------------------------------------------------------------------

-- 5.1. PAYMENTS: Officers/DevAdmin can SELECT & INSERT. Students can SELECT own. NO DELETE.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage payments" ON public.payments;
DROP POLICY IF EXISTS payments_officer_devadmin ON public.payments;
DROP POLICY IF EXISTS payments_student_read ON public.payments;
DROP POLICY IF EXISTS "Students view own payments" ON public.payments;
DROP POLICY IF EXISTS payments_select_authorized ON public.payments;
DROP POLICY IF EXISTS payments_insert_authorized ON public.payments;
DROP POLICY IF EXISTS payments_update_authorized ON public.payments;
DROP POLICY IF EXISTS payments_delete_authorized ON public.payments;

CREATE POLICY payments_select_authorized ON public.payments
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR student_id = public.get_current_user_student_id()
  );

CREATE POLICY payments_insert_authorized ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE POLICY payments_update_authorized ON public.payments
  FOR UPDATE TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE OR REPLACE FUNCTION public.trg_protect_immutable_payments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Payments are immutable ledger records and cannot be deleted. Use transaction reversal or adjustment instead.';
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_immutable_payments() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_immutable_payments() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_immutable_payments ON public.payments;
CREATE TRIGGER trg_protect_immutable_payments
  BEFORE DELETE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_immutable_payments();

-- 5.2. PAYMENT ALLOCATIONS: Officers/DevAdmin can SELECT & INSERT. Students can SELECT own. NO DELETE.
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Officers manage payment allocations" ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_officer_devadmin ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_student_read ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_select_authorized ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_insert_authorized ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_update_authorized ON public.payment_allocations;
DROP POLICY IF EXISTS payment_allocations_delete_authorized ON public.payment_allocations;

CREATE POLICY payment_allocations_select_authorized ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR EXISTS (
      SELECT 1 FROM public.student_obligations so
      WHERE so.id = payment_allocations.obligation_id
        AND so.student_id = public.get_current_user_student_id()
    )
  );

CREATE POLICY payment_allocations_insert_authorized ON public.payment_allocations
  FOR INSERT TO authenticated
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

CREATE OR REPLACE FUNCTION public.trg_protect_immutable_payment_allocations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Payment allocations are immutable financial records and cannot be deleted.';
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_immutable_payment_allocations() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_immutable_payment_allocations() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_immutable_payment_allocations ON public.payment_allocations;
CREATE TRIGGER trg_protect_immutable_payment_allocations
  BEFORE DELETE ON public.payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_immutable_payment_allocations();

-- 5.3. ATTENDANCE AUDIT & SYSTEM AUDIT LOGS: Immutable, NO DELETE.
CREATE OR REPLACE FUNCTION public.trg_protect_immutable_audit_logs()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are immutable and cannot be deleted.';
END;
$$;

REVOKE ALL ON FUNCTION public.trg_protect_immutable_audit_logs() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trg_protect_immutable_audit_logs() TO authenticated;

DROP TRIGGER IF EXISTS trg_protect_immutable_attendance_audit ON public.attendance_audit;
CREATE TRIGGER trg_protect_immutable_attendance_audit
  BEFORE DELETE ON public.attendance_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_immutable_audit_logs();

DROP TRIGGER IF EXISTS trg_protect_immutable_audit_logs ON public.audit_logs;
CREATE TRIGGER trg_protect_immutable_audit_logs
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_immutable_audit_logs();

COMMIT;
