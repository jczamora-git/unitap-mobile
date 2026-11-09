-- ==============================================================================
-- Migration: 20261110010000_devadmin_officer_appointments_rls.sql
-- Description:
--   Fix Officer Management RLS Visibility:
--   1. Allow authenticated DEVADMIN users to SELECT all officer appointments
--      using public.get_current_user_role() = 'DEVADMIN'.
--   2. Preserve ordinary officers' existing SELECT policy to view their own
--      appointment (user_id = auth.uid() AND status IN ('ACTIVE', 'SUSPENDED')).
--   3. Restrict INSERT, UPDATE, and DELETE operations on officer_appointments to DEVADMIN.
--   4. Never expose officer appointments to unauthenticated (anon) users.
--   5. Maintain Row Level Security (RLS enabled).
-- ==============================================================================

-- 1. Ensure RLS is active on officer_appointments
ALTER TABLE IF EXISTS public.officer_appointments ENABLE ROW LEVEL SECURITY;

-- 2. Drop previous conflicting DevAdmin policies on officer_appointments if present
DO $$
BEGIN
  DROP POLICY IF EXISTS "DevAdmin full access on officer_appointments" ON public.officer_appointments;
  DROP POLICY IF EXISTS "DevAdmin view all officer_appointments" ON public.officer_appointments;
  DROP POLICY IF EXISTS "DevAdmin select officer_appointments" ON public.officer_appointments;
  DROP POLICY IF EXISTS "DevAdmin modify officer_appointments" ON public.officer_appointments;
  DROP POLICY IF EXISTS "DevAdmin insert officer_appointments" ON public.officer_appointments;
  DROP POLICY IF EXISTS "DevAdmin update officer_appointments" ON public.officer_appointments;
  DROP POLICY IF EXISTS "DevAdmin delete officer_appointments" ON public.officer_appointments;
END $$;

-- 3. DEVADMIN SELECT policy: Allows DEVADMIN to view all officer appointments
CREATE POLICY "DevAdmin view all officer_appointments"
  ON public.officer_appointments
  FOR SELECT
  TO authenticated
  USING (
    public.get_current_user_role() = 'DEVADMIN'
  );

-- 4. DEVADMIN Mutation policies: INSERT, UPDATE, DELETE strictly restricted to DEVADMIN
CREATE POLICY "DevAdmin insert officer_appointments"
  ON public.officer_appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.get_current_user_role() = 'DEVADMIN'
  );

CREATE POLICY "DevAdmin update officer_appointments"
  ON public.officer_appointments
  FOR UPDATE
  TO authenticated
  USING (
    public.get_current_user_role() = 'DEVADMIN'
  )
  WITH CHECK (
    public.get_current_user_role() = 'DEVADMIN'
  );

CREATE POLICY "DevAdmin delete officer_appointments"
  ON public.officer_appointments
  FOR DELETE
  TO authenticated
  USING (
    public.get_current_user_role() = 'DEVADMIN'
  );

-- Note: Existing policy "Officers view own appointment":
--   FOR SELECT TO authenticated USING (user_id = auth.uid() AND status IN ('ACTIVE', 'SUSPENDED'))
-- remains intact and permissive. DEVADMIN matches the DEVADMIN policy; ordinary officers match their own appointment.

