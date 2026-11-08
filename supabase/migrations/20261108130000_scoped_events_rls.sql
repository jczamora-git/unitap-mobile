-- ============================================================================
-- UniTap 2.0 Scoped Events & Event Occurrences Row Level Security (RLS)
-- File: 20261108130000_scoped_events_rls.sql
-- ============================================================================
-- Purpose:
--   Enforce fine-grained, appointment-scoped RLS policies on `public.events`
--   and `public.event_occurrences`.
--
-- Security Rules Enforced:
--   1. DEVADMIN retains full event management (bypass appointment requirements).
--   2. Authenticated users (Officers, DevAdmins, Students) have read access to events & occurrences.
--   3. Anonymous (anon) users are strictly denied all access.
--   4. OFFICER access requires an active, non-expired, non-revoked appointment.
--   5. INSERT requires `events.create` permission (FULL or CUSTOM preset).
--   6. UPDATE/DELETE requires `events.edit_assigned` permission within appointment scope.
--   7. ATTENDANCE and FINANCE presets receive NO event mutation access.
--   8. Scope enforcement: ORGANIZATION-wide or assigned EVENT scope (oa.scope_id = event.id),
--      matching semester_id if configured.
-- ============================================================================

-- 1. Ensure Row Level Security is enabled on both tables
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_occurrences ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies on events and event_occurrences via pg_catalog inspection
--    (Avoids guessing policy names or missing custom/adhoc dashboard policies)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename IN ('events', 'event_occurrences')
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 3. Security Definer Helper: can_user_insert_event
CREATE OR REPLACE FUNCTION public.can_user_insert_event(
  p_semester_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_role TEXT;
BEGIN
  v_role := public.get_current_user_role();

  -- DEVADMIN retains unrestricted full event management
  IF v_role = 'DEVADMIN' THEN
    RETURN true;
  END IF;

  -- OFFICER access must require an active, non-expired appointment
  IF v_role = 'OFFICER' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.officer_appointments oa
      WHERE oa.user_id = auth.uid()
        AND oa.status = 'ACTIVE'
        AND oa.appointment_start <= now()
        AND oa.appointment_end >= now()
        AND oa.revoked_at IS NULL
        AND oa.suspended_at IS NULL
        -- Respect FULL and CUSTOM presets (require events.create)
        -- ATTENDANCE and FINANCE officers do not receive events.create
        AND (
          oa.permission_preset = 'FULL'
          OR (oa.permission_preset = 'CUSTOM' AND coalesce(oa.custom_permissions, '[]'::jsonb) ? 'events.create')
        )
        -- Event creation requires ORGANIZATION-level scope
        AND oa.scope_type = 'ORGANIZATION'
        -- Respect officer semester scope if set
        AND (
          oa.semester_id IS NULL
          OR p_semester_id IS NULL
          OR oa.semester_id = p_semester_id
        )
    );
  END IF;

  RETURN false;
END;
$$;

-- 4. Security Definer Helper: can_user_manage_event
CREATE OR REPLACE FUNCTION public.can_user_manage_event(
  p_event_id UUID,
  p_semester_id TEXT DEFAULT NULL,
  p_required_permission TEXT DEFAULT 'events.edit_assigned'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_role TEXT;
  v_semester_id TEXT;
BEGIN
  v_role := public.get_current_user_role();

  -- DEVADMIN retains unrestricted full event management
  IF v_role = 'DEVADMIN' THEN
    RETURN true;
  END IF;

  -- OFFICER access must require an active, non-expired appointment
  IF v_role = 'OFFICER' THEN
    -- Resolve semester_id from event record if not provided
    v_semester_id := p_semester_id;
    IF v_semester_id IS NULL AND p_event_id IS NOT NULL THEN
      SELECT semester_id INTO v_semester_id
      FROM public.events
      WHERE id = p_event_id;
    END IF;

    RETURN EXISTS (
      SELECT 1
      FROM public.officer_appointments oa
      WHERE oa.user_id = auth.uid()
        AND oa.status = 'ACTIVE'
        AND oa.appointment_start <= now()
        AND oa.appointment_end >= now()
        AND oa.revoked_at IS NULL
        AND oa.suspended_at IS NULL
        -- Respect FULL and CUSTOM presets (require events.edit_assigned)
        -- ATTENDANCE and FINANCE officers do not receive events.edit_assigned
        AND (
          oa.permission_preset = 'FULL'
          OR (
            oa.permission_preset = 'CUSTOM' 
            AND (
              coalesce(oa.custom_permissions, '[]'::jsonb) ? p_required_permission
              OR coalesce(oa.custom_permissions, '[]'::jsonb) ? 'events.edit_assigned'
            )
          )
        )
        -- Respect officer scope: ORGANIZATION-wide or assigned to this specific EVENT
        AND (
          oa.scope_type = 'ORGANIZATION'
          OR (oa.scope_type = 'EVENT' AND oa.scope_id = p_event_id)
        )
        -- Respect semester scope if set on appointment
        AND (
          oa.semester_id IS NULL
          OR v_semester_id IS NULL
          OR oa.semester_id = v_semester_id
        )
    );
  END IF;

  RETURN false;
END;
$$;

-- 5. Revoke public/anon execution and grant authenticated execution
REVOKE ALL ON FUNCTION public.can_user_insert_event(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_user_insert_event(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.can_user_manage_event(UUID, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_user_manage_event(UUID, TEXT, TEXT) TO authenticated;

-- 6. RLS Policies on public.events
-- 6.1. Authenticated users (Officers, DevAdmins, Students) can view events
CREATE POLICY events_select_authenticated ON public.events
  FOR SELECT TO authenticated
  USING (true);

-- 6.2. Authorized officers and DevAdmin can insert events (requires events.create)
CREATE POLICY events_insert_authorized ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (public.can_user_insert_event(semester_id));

-- 6.3. Authorized officers and DevAdmin can update events (requires events.edit_assigned within scope)
CREATE POLICY events_update_authorized ON public.events
  FOR UPDATE TO authenticated
  USING (public.can_user_manage_event(id, semester_id, 'events.edit_assigned'))
  WITH CHECK (public.can_user_manage_event(id, semester_id, 'events.edit_assigned'));

-- 6.4. Authorized officers and DevAdmin can delete events (requires events.edit_assigned within scope)
CREATE POLICY events_delete_authorized ON public.events
  FOR DELETE TO authenticated
  USING (public.can_user_manage_event(id, semester_id, 'events.edit_assigned'));

-- 7. RLS Policies on public.event_occurrences
-- 7.1. Authenticated users can view occurrences
CREATE POLICY event_occurrences_select_authenticated ON public.event_occurrences
  FOR SELECT TO authenticated
  USING (true);

-- 7.2. Insert occurrences requires management privileges on parent event
CREATE POLICY event_occurrences_insert_authorized ON public.event_occurrences
  FOR INSERT TO authenticated
  WITH CHECK (public.can_user_manage_event(event_id, NULL, 'events.create'));

-- 7.3. Update occurrences requires edit privileges on parent event
CREATE POLICY event_occurrences_update_authorized ON public.event_occurrences
  FOR UPDATE TO authenticated
  USING (public.can_user_manage_event(event_id, NULL, 'events.edit_assigned'))
  WITH CHECK (public.can_user_manage_event(event_id, NULL, 'events.edit_assigned'));

-- 7.4. Delete occurrences requires edit privileges on parent event
CREATE POLICY event_occurrences_delete_authorized ON public.event_occurrences
  FOR DELETE TO authenticated
  USING (public.can_user_manage_event(event_id, NULL, 'events.edit_assigned'));

