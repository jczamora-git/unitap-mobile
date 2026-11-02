-- UniTap 2.0: Read-only diagnostics. Run in Supabase SQL Editor.
-- Does not change tables, RLS, roles, functions, or data.

-- 1. Object-level RLS status, including tables with no policies.
SELECT c.oid::regclass AS object_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       COUNT(p.policyname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
GROUP BY c.oid, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.oid::regclass::text;

-- 2. Functions exposed to anonymous/authenticated callers.
SELECT p.oid::regprocedure AS routine,
       pg_get_userbyid(p.proowner) AS owner_name,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.oid::regprocedure::text;

-- 3. Raw table grants (look for anonymous/authenticated broad privileges).
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC')
ORDER BY table_name, grantee, privilege_type;

-- 4. Default privileges actually recorded in the database.
SELECT pg_get_userbyid(d.defaclrole) AS grantor,
       COALESCE(n.nspname, '<global>') AS scope,
       d.defaclobjtype AS object_type,
       d.defaclacl AS acl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY grantor, scope, object_type;

-- 5. Missing timestamp columns for entities used by timestamp-based batch pull.
WITH targets(name) AS (VALUES
 ('academic_years'),('semesters'),('programs'),('year_levels'),
 ('sections'),('event_categories'),('obligation_rules'),('events'),
 ('event_occurrences'),('event_participants'),('students'),
 ('student_enrollments'),('nfc_cards'),('attendance_records'),
 ('student_obligations'),('payments'),('payment_allocations'))
SELECT t.name,
       EXISTS (SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema='public' AND c.table_name=t.name
               AND c.column_name='updated_at') AS has_updated_at
FROM targets t ORDER BY t.name;

-- 6. Check whether key relationships still have constraints after text conversions.
SELECT
    tc.table_name AS from_table,
    tc.constraint_name,
    ccu.table_name AS to_table,
    kcu.column_name AS from_column,
    ccu.column_name AS to_column
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, tc.constraint_name;

-- 7. Verify whether pull change log is being populated (aggregate counts only).
SELECT count(*) AS change_count,
       coalesce(max(cursor),0) AS max_cursor
FROM public.sync_change_log;

-- 8. Inspect deployed routines and signatures before replacing them.
SELECT p.oid::regprocedure AS routine, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
 AND p.proname IN ('sync_push_batch','sync_pull_batch','sync_pull_changes',
 'activate_student_account','verify_and_claim_student_code',
 'officer_get_student_activation_status')
ORDER BY p.proname;
