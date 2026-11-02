-- UniTap 2.0 — emergency RPC containment ONLY.
-- REVIEW WITH THE AUTHORIZED DATABASE OWNER BEFORE APPLYING.
-- This migration DISABLES the vulnerable API endpoints rather than pretending
-- to repair synchronization or account activation. Those workflows will stop
-- until secure replacements are deployed. Do not apply while relying on them.
-- Keeps previously applied migration history and existing data unchanged.
-- Assumes the functions are in public as in the seven supplied migrations.

BEGIN;

-- Stop unauthenticated/authenticated privilege escalation and unsafely scoped
-- synchronisation. Existing data and outbox records are not deleted.
REVOKE EXECUTE ON FUNCTION public.sync_pull_batch(timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_push_batch(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_pull_changes(bigint, integer)
  FROM PUBLIC, anon, authenticated;

-- Student activation functions with caller identity spoofing, unaudited code
-- consumption, or unauthorised status/identity disclosure are quarantined.
REVOKE EXECUTE ON FUNCTION public.activate_student_account(text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_and_claim_student_code(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_activation_code(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.officer_get_student_activation_status(uuid)
  FROM PUBLIC, anon, authenticated;

-- Undo direct anonymous broad grants created by the 18:30 migration.
-- This may also interrupt any intentional unauthenticated public endpoints.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM anon;

-- Reverse the per-schema extra default GRANT ALL from the 18:30 migration
-- for objects created by the role executing THIS patch. If the historical
-- migration used a different grantor, review pg_default_acl and repeat as
-- that grantor. These statements do NOT undo existing authenticated table
-- grants nor PostgreSQL's global default PUBLIC function EXECUTE setting.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;

COMMIT;

-- Still required before production reuse:
-- 1. Inspect and replace authenticated GRANT ALL on existing tables/routines.
-- 2. Enable and test RLS on ALL personal-data tables.
-- 3. Repair role-scoped sync push/pull, pagination, change log, and FK integrity.
-- 4. Patch account activation and officer assignment logic, then regrant only
--    the specific corrected RPCs to authenticated.
-- 5. No security patch can retroactively undo any prior data exposure.
