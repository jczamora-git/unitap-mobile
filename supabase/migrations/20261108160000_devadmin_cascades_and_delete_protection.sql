-- ==============================================================================
-- Migration: 20261108160000_devadmin_cascades_and_delete_protection.sql
-- Description:
--   UniTap 2.0 DEVADMIN-Only Deletion & Cascading Child Record Cleanup Architecture:
--   1. Reconfigures Foreign Key CASCADE from obligation_rules to student_obligations.
--   2. Enforces Financial Immutability & Deletion Protection via BEFORE DELETE triggers:
--      - Prevents deleting obligation_rules if payment allocations exist.
--      - Prevents deleting student_obligations if payment allocations exist.
--      - Prevents deleting events if paid absence fines exist (and cleans up unpaid absence fines).
--      - Prevents deleting students if financial payments or allocations exist.
--      - Prevents deleting academic_years or semesters if recorded payments exist.
--   3. Restricts DELETE privileges strictly to DEVADMIN across all management entities:
--      - students, student_enrollments, nfc_cards
--      - obligation_rules, student_obligations
--      - events, event_occurrences
--      - programs, sections, academic_years, semesters, event_categories
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. FOREIGN KEY CASCADE CONFIGURATION
-- ------------------------------------------------------------------------------

-- 1.1. student_obligations -> obligation_rules (CASCADE when unpaid rule is deleted)
ALTER TABLE public.student_obligations
  DROP CONSTRAINT IF EXISTS student_obligations_rule_id_fkey;

ALTER TABLE public.student_obligations
  ADD CONSTRAINT student_obligations_rule_id_fkey
  FOREIGN KEY (rule_id)
  REFERENCES public.obligation_rules(id)
  ON DELETE CASCADE;

-- ------------------------------------------------------------------------------
-- 2. FINANCIAL INTEGRITY & DELETION PROTECTION TRIGGERS
-- ------------------------------------------------------------------------------

-- 2.1. Obligation Rules: Protect against deleting collections that have payments
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

DROP TRIGGER IF EXISTS trg_protect_obligation_rule_deletion ON public.obligation_rules;
CREATE TRIGGER trg_protect_obligation_rule_deletion
  BEFORE DELETE ON public.obligation_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_obligation_rule_deletion();

-- 2.2. Student Obligations: Protect against deleting obligations that have payments
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

DROP TRIGGER IF EXISTS trg_protect_student_obligation_deletion ON public.student_obligations;
CREATE TRIGGER trg_protect_student_obligation_deletion
  BEFORE DELETE ON public.student_obligations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_student_obligation_deletion();

-- 2.3. Events: Protect against deleting events with paid absence fines; cleanup unpaid absence fines
CREATE OR REPLACE FUNCTION public.trg_protect_event_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_paid_fines BOOLEAN;
BEGIN
  -- Check if paid fines exist for this event or its occurrences
  SELECT EXISTS (
    SELECT 1
    FROM public.student_obligations so
    JOIN public.payment_allocations pa ON pa.obligation_id = so.id
    WHERE so.related_event_id = OLD.id
       OR so.related_occurrence_id IN (
         SELECT id FROM public.event_occurrences WHERE event_id = OLD.id
       )
  ) INTO v_has_paid_fines;

  IF v_has_paid_fines THEN
    RAISE EXCEPTION 'Cannot delete event because paid absence fines are associated with it. Please archive or deactivate the event instead.';
  END IF;

  -- Clean up unpaid operational absence fines associated with the event
  DELETE FROM public.student_obligations
  WHERE (
    related_event_id = OLD.id
    OR related_occurrence_id IN (
      SELECT id FROM public.event_occurrences WHERE event_id = OLD.id
    )
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_event_deletion ON public.events;
CREATE TRIGGER trg_protect_event_deletion
  BEFORE DELETE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_event_deletion();

-- 2.4. Students: Protect against deleting students with recorded payments
CREATE OR REPLACE FUNCTION public.trg_protect_student_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_payments BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.payments WHERE student_id = OLD.id
  ) OR EXISTS (
    SELECT 1
    FROM public.student_obligations so
    JOIN public.payment_allocations pa ON pa.obligation_id = so.id
    WHERE so.student_id = OLD.id
  ) INTO v_has_payments;

  IF v_has_payments THEN
    RAISE EXCEPTION 'Cannot delete student because financial payments or allocations exist. Deactivate the student record instead.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_student_deletion ON public.students;
CREATE TRIGGER trg_protect_student_deletion
  BEFORE DELETE ON public.students
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_student_deletion();

-- 2.5. Academic Years & Semesters: Protect against deleting periods with recorded payments
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
    SELECT 1 FROM public.payments WHERE semester_id = OLD.id
  ) INTO v_has_payments;

  IF v_has_payments THEN
    RAISE EXCEPTION 'Cannot delete semester because financial payment records are associated with it. Deactivate instead.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_semester_deletion ON public.semesters;
CREATE TRIGGER trg_protect_semester_deletion
  BEFORE DELETE ON public.semesters
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_protect_semester_deletion();

-- ------------------------------------------------------------------------------
-- 3. DEVADMIN-ONLY DELETE ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

-- 3.1. STUDENTS: Officers can SELECT, INSERT, UPDATE. DEVADMIN ONLY can DELETE.
DROP POLICY IF EXISTS "Officers manage all students" ON public.students;
DROP POLICY IF EXISTS "Students select authorized" ON public.students;
DROP POLICY IF EXISTS "Students insert authorized" ON public.students;
DROP POLICY IF EXISTS "Students update authorized" ON public.students;
DROP POLICY IF EXISTS "Students delete authorized" ON public.students;

CREATE POLICY "Students select authorized" ON public.students
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR id = (SELECT student_id FROM public.users WHERE id = auth.uid())
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

-- 3.2. STUDENT ENROLLMENTS: DEVADMIN ONLY can DELETE.
DROP POLICY IF EXISTS "Enrollments select authorized" ON public.student_enrollments;
DROP POLICY IF EXISTS "Enrollments insert authorized" ON public.student_enrollments;
DROP POLICY IF EXISTS "Enrollments update authorized" ON public.student_enrollments;
DROP POLICY IF EXISTS "Enrollments delete authorized" ON public.student_enrollments;

CREATE POLICY "Enrollments select authorized" ON public.student_enrollments
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR student_id = (SELECT student_id FROM public.users WHERE id = auth.uid())
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

-- 3.3. NFC CARDS: DEVADMIN ONLY can DELETE.
DROP POLICY IF EXISTS "Nfc cards select authorized" ON public.nfc_cards;
DROP POLICY IF EXISTS "Nfc cards insert authorized" ON public.nfc_cards;
DROP POLICY IF EXISTS "Nfc cards update authorized" ON public.nfc_cards;
DROP POLICY IF EXISTS "Nfc cards delete authorized" ON public.nfc_cards;

CREATE POLICY "Nfc cards select authorized" ON public.nfc_cards
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR student_id = (SELECT student_id FROM public.users WHERE id = auth.uid())
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

-- 3.4. OBLIGATION RULES: DEVADMIN ONLY can DELETE.
DROP POLICY IF EXISTS obligation_rules_officer_devadmin ON public.obligation_rules;
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

-- 3.5. STUDENT OBLIGATIONS: DEVADMIN ONLY can DELETE.
DROP POLICY IF EXISTS "Officers manage student obligations" ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_select_authorized ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_insert_authorized ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_update_authorized ON public.student_obligations;
DROP POLICY IF EXISTS student_obligations_delete_authorized ON public.student_obligations;

CREATE POLICY student_obligations_select_authorized ON public.student_obligations
  FOR SELECT TO authenticated
  USING (
    public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
    OR student_id = (SELECT student_id FROM public.users WHERE id = auth.uid())
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

-- 3.6. EVENTS & EVENT OCCURRENCES: DEVADMIN ONLY can DELETE.
DROP POLICY IF EXISTS events_delete_authorized ON public.events;
CREATE POLICY events_delete_authorized ON public.events
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

DROP POLICY IF EXISTS event_occurrences_delete_authorized ON public.event_occurrences;
CREATE POLICY event_occurrences_delete_authorized ON public.event_occurrences
  FOR DELETE TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN');

-- 3.7. PROGRAMS: Enable RLS & restrict DELETE to DEVADMIN.
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS programs_select_authenticated ON public.programs;
CREATE POLICY programs_select_authenticated ON public.programs
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS programs_devadmin_manage ON public.programs;
CREATE POLICY programs_devadmin_manage ON public.programs
  FOR ALL TO authenticated
  USING (public.get_current_user_role() = 'DEVADMIN')
  WITH CHECK (public.get_current_user_role() = 'DEVADMIN');

