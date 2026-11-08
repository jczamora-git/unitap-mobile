-- ==============================================================================
-- UniTap 2.0: Student Self-Service Photo Permissions & Secure Storage RPC
-- Migration: 20261108180000_student_self_service_photo_permissions.sql
--
-- Description:
-- 1. Grants authenticated students granular INSERT, UPDATE, and DELETE RLS
--    privileges on 'student-profile-photos' strictly restricted to their own
--    student UUID folder (resolved via public.get_current_user_student_id()).
-- 2. Preserves existing DEVADMIN and active OFFICER storage management policies.
-- 3. Provides a secure SECURITY DEFINER RPC public.update_student_profile_photo_path()
--    allowing students to update only their own photo_storage_path without
--    broadening direct table-level UPDATE privileges on public.students.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. STORAGE POLICIES: student-profile-photos
-- ------------------------------------------------------------------------------

-- 1.1. Drop any previous student mutation policies if they exist
DROP POLICY IF EXISTS "Students upload own profile photo" ON storage.objects;
DROP POLICY IF EXISTS "Students update own profile photo" ON storage.objects;
DROP POLICY IF EXISTS "Students delete own profile photo" ON storage.objects;

-- 1.2. Authenticated Students can INSERT their own profile photo
-- Restricted strictly to approved profile filenames within their own student UUID folder:
-- {student_uuid}/profile.webp, {student_uuid}/profile.jpg, {student_uuid}/profile.jpeg, {student_uuid}/profile.png
CREATE POLICY "Students upload own profile photo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_student_id() IS NOT NULL
    AND name IN (
      public.get_current_user_student_id()::text || '/profile.webp',
      public.get_current_user_student_id()::text || '/profile.jpg',
      public.get_current_user_student_id()::text || '/profile.jpeg',
      public.get_current_user_student_id()::text || '/profile.png'
    )
  );

-- 1.3. Authenticated Students can UPDATE their own profile photo
-- Enforces both USING and WITH CHECK to ensure existing and replacement paths match their UUID and approved filenames
CREATE POLICY "Students update own profile photo"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_student_id() IS NOT NULL
    AND name IN (
      public.get_current_user_student_id()::text || '/profile.webp',
      public.get_current_user_student_id()::text || '/profile.jpg',
      public.get_current_user_student_id()::text || '/profile.jpeg',
      public.get_current_user_student_id()::text || '/profile.png'
    )
  )
  WITH CHECK (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_student_id() IS NOT NULL
    AND name IN (
      public.get_current_user_student_id()::text || '/profile.webp',
      public.get_current_user_student_id()::text || '/profile.jpg',
      public.get_current_user_student_id()::text || '/profile.jpeg',
      public.get_current_user_student_id()::text || '/profile.png'
    )
  );

-- 1.4. Authenticated Students can DELETE their own previous profile photo
CREATE POLICY "Students delete own profile photo"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'student-profile-photos'
    AND public.get_current_user_student_id() IS NOT NULL
    AND name IN (
      public.get_current_user_student_id()::text || '/profile.webp',
      public.get_current_user_student_id()::text || '/profile.jpg',
      public.get_current_user_student_id()::text || '/profile.jpeg',
      public.get_current_user_student_id()::text || '/profile.png'
    )
  );

-- ------------------------------------------------------------------------------
-- 2. SECURE RPC: update_student_profile_photo_path
-- ------------------------------------------------------------------------------
-- Allows authenticated students to update ONLY their own students.photo_storage_path.
-- Rejects cross-student updates, directory traversal, unapproved extensions,
-- or modifications to any other student table column.
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_student_profile_photo_path(p_storage_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_student_id uuid;
  v_expected_prefix text;
  v_filename text;
BEGIN
  -- 1. Require authenticated session
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Resolve authenticated student UUID via trusted helper
  v_student_id := public.get_current_user_student_id();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'No linked student profile found for authenticated user.' USING ERRCODE = '42501';
  END IF;

  -- 3. Handle removal (NULL or empty string)
  IF p_storage_path IS NULL OR trim(p_storage_path) = '' THEN
    UPDATE public.students
    SET photo_storage_path = NULL,
        updated_at = now()
    WHERE id = v_student_id;

    RETURN jsonb_build_object(
      'success', true,
      'student_id', v_student_id,
      'photo_storage_path', NULL
    );
  END IF;

  -- 4. Validate prefix against authenticated student UUID
  v_expected_prefix := v_student_id::text || '/';
  IF NOT (p_storage_path LIKE (v_expected_prefix || '%')) THEN
    RAISE EXCEPTION 'Cross-student upload denied: storage path must match authenticated student UUID.' USING ERRCODE = '42501';
  END IF;

  -- 5. Validate approved filename (profile.webp, profile.jpg, profile.jpeg, profile.png)
  v_filename := substring(p_storage_path from (length(v_expected_prefix) + 1));
  IF v_filename NOT IN ('profile.webp', 'profile.jpg', 'profile.jpeg', 'profile.png') THEN
    RAISE EXCEPTION 'Invalid profile photo filename. Only approved profile filenames are allowed.' USING ERRCODE = '22023';
  END IF;

  -- 6. Update only photo_storage_path and updated_at
  UPDATE public.students
  SET photo_storage_path = p_storage_path,
      updated_at = now()
  WHERE id = v_student_id;

  RETURN jsonb_build_object(
    'success', true,
    'student_id', v_student_id,
    'photo_storage_path', p_storage_path
  );
END;
$$;

-- Revoke public execution and grant strictly to authenticated users
REVOKE ALL ON FUNCTION public.update_student_profile_photo_path(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_student_profile_photo_path(text) TO authenticated;

COMMIT;

