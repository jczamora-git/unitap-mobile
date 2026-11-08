-- ==============================================================================
-- UniTap Migration: Fix student_obligations RLS for Direct Supabase Mode
-- Migration File: supabase/migrations/20261108150000_fix_student_obligations_rls.sql
--
-- Purpose:
--   Resolves RLS violation on public.student_obligations during Direct Supabase
--   contribution student assignment and bulk obligation assessment.
--
-- Root Cause:
--   Migration 20261101000000_student_activation_and_rls.sql defined the policy
--   "Officers manage student obligations" with a direct subquery against public.user_roles:
--     EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') ...)
--   Because user_roles itself enforces RLS, direct subqueries from within another
--   table's RLS policy can fail or produce empty sets due to recursive or restrictive
--   role evaluations.
--
-- Solution:
--   1. Replaces the direct subquery with the canonical SECURITY DEFINER helper:
--      public.get_current_user_role() IN ('DEVADMIN', 'OFFICER')
--   2. Explicitly specifies both USING and WITH CHECK clauses for complete CRUD coverage
--      (SELECT, INSERT, UPDATE, DELETE).
--   3. Preserves student own-record SELECT access via "Students view own obligations".
--   4. Keeps RLS enabled and strictly restricts access to authenticated users.
-- ==============================================================================

-- 1. Ensure Row Level Security is enabled
ALTER TABLE public.student_obligations ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing officer management policies
DROP POLICY IF EXISTS "Officers manage student obligations" ON public.student_obligations;
DROP POLICY IF EXISTS "student_obligations_officer_devadmin" ON public.student_obligations;

-- 3. Create hardened officer/devadmin management policy using SECURITY DEFINER helper
CREATE POLICY "Officers manage student obligations" ON public.student_obligations
  FOR ALL TO authenticated
  USING (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'))
  WITH CHECK (public.get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

-- 4. Preserve student own-record SELECT access
DROP POLICY IF EXISTS "Students view own obligations" ON public.student_obligations;
DROP POLICY IF EXISTS "student_obligations_student_read" ON public.student_obligations;

CREATE POLICY "Students view own obligations" ON public.student_obligations
  FOR SELECT TO authenticated
  USING (
    student_id = (SELECT student_id FROM public.users WHERE id = auth.uid())
  );

