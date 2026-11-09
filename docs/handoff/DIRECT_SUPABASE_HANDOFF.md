# Direct Supabase Student Reading — Handoff Document

**Date:** November 8, 2026  
**Status:** Completed & Verified  
**Scope:** Direct Supabase Mode Student Directory Reading, Repository Integrity, UI Error States, and Error Propagation

---

## 1. Confirmed Root Causes

1. **Unchecked PostgREST Responses in `StudentService`**:
   - `fetchStudentsDirect()` queried four remote tables concurrently (`students`, `student_enrollments`, `programs`, and `nfc_cards`), but only checked `studentsRes.error`.
   - If querying enrollments, programs, or NFC cards failed (e.g., due to RLS restrictions or network issues), the errors were silently ignored and mapped to empty datasets, returning partial or empty student entities.
   - Similarly, `fetchStudentDirectById()` omitted error checks on enrollments, programs, and cards.

2. **Error Swallowing in `useStudents.loadStudents()`**:
   - When a remote query failed, `loadStudents()` caught the error, set `error.value = msg`, and returned `[]`.
   - Callers awaiting `loadStudents()` received an empty array and treated it as an empty database rather than an active remote query failure.

3. **Missing Error Exposure & Duplicate Invocations in `StudentsPage.vue`**:
   - `StudentsPage.vue` did not destructure or display the `error` state from `useStudents()`.
   - When remote queries failed, `totalCount === 0` triggered the default "No students yet" empty state, misleading users into believing no students were registered.
   - Both `onMounted` and `onIonViewWillEnter` called `loadStudents()`, causing duplicate initial remote fetches.

4. **Misleading Zero KPI in `HomePage.vue`**:
   - `loadDashboardData()` logged student query errors to `console.error` but left `totalStudents` at 0 without notifying the UI of a failure state.
   - The Home Dashboard displayed "0 Registered" students instead of indicating an error or unavailable status.

5. **Direct Mode Leakage & Unchecked Errors in `StudentsRepository`**:
   - `StudentsRepository.getStudents()` only inspected `studentsRes.error`, omitting checks for `enrollmentsRes.error` and `cardsRes.error`.
   - `StudentsRepository.getStudentsByCanonicalSchoolId()` had no `DataModeService.isDirectSupabase()` branch and leaked unconditionally to the local SQLite database.

6. **Security & RLS Subquery Root Cause**:
   - The live database audit revealed that `user_roles` has RLS enabled with 0 policies.
   - Existing student and enrollment RLS policies directly query `user_roles` (`auth.uid() IN (SELECT user_id FROM user_roles WHERE ...)`). Because `user_roles` blocks unprivileged direct queries, the subquery yields empty results, causing Supabase to reject student/enrollment reads.
   - The intended architecture uses the existing security-definer helper `get_current_user_role()`, which bypasses caller table RLS safely while maintaining server-side role resolution.

---

## 2. Files Modified

| File | Changes Made |
| :--- | :--- |
| `src/services/student.service.ts` | Checked and propagated errors from all 4 Supabase queries (`students`, `student_enrollments`, `programs`, `nfc_cards`) in `fetchStudentsDirect()` and `fetchStudentDirectById()`. |
| `src/composables/useStudents.ts` | Updated `loadStudents()` to rethrow caught errors after setting reactive `error.value`, preventing failed remote reads from returning `[]`. |
| `src/views/StudentsPage.vue` | Destructured `error` from `useStudents()`, rendered a dedicated `UniEmptyState` error view with retry action, and removed duplicate loading from `onMounted`. |
| `src/views/HomePage.vue` | Added `studentsError` tracking to dashboard state, rendering an "Unavailable" / "Failed to load" status on the Students metric card if query fails. |
| `src/database/repositories/students.repository.ts` | Added Direct Supabase branch to `getStudentsByCanonicalSchoolId()` to prevent SQLite leakage; checked all query errors in `getStudents()`. |
| `src/services/event.service.ts` | Switched `createEvent` ID generation to raw UUIDs (removing `evt_` prefix) and implemented `toSupabaseEventInsertPayload` excluding `description` (fixing PGRST204) while preserving UI and offline data. |
| `src/database/repositories/events.repository.ts` | Implemented `toSupabaseEventPayload` in `createEvent`, stripping `evt_` prefixes and omitting `description` and `created_by_user_id` from the Supabase INSERT payload. |
| `tests/unit/supabase-direct-diagnostic.spec.ts` | Diagnostic suite covering student error propagation, composable error re-throw, repository direct routing, and event Direct Supabase raw UUID & payload sanitation. |

---

## 3. Fixes Implemented

### 3.1. `src/services/student.service.ts`
- Added explicit error propagation in `fetchStudentsDirect()`:
  ```typescript
  if (studentsRes.error) throw new Error(`Failed to query students from Supabase: ${studentsRes.error.message}`);
  if (enrollmentsRes.error) throw new Error(`Failed to query student enrollments from Supabase: ${enrollmentsRes.error.message}`);
  if (programsRes.error) throw new Error(`Failed to query programs from Supabase: ${programsRes.error.message}`);
  if (cardsRes.error) throw new Error(`Failed to query NFC cards from Supabase: ${cardsRes.error.message}`);
  ```
- Added matching error propagation in `fetchStudentDirectById()`.

### 3.2. `src/composables/useStudents.ts`
- Updated `loadStudents()` catch block to preserve the error on the reactive ref and re-throw:
  ```typescript
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    error.value = msg;
    throw err;
  }
  ```

### 3.3. `src/views/StudentsPage.vue`
- Exposed `error` from `useStudents()`.
- Implemented `handleRetry()` to allow officers to re-fetch on network/RLS recovery.
- Rendered `UniEmptyState` error card with `alertCircleOutline` and "Retry" button when `error` is present.
- Consolidated initial loading into `onIonViewWillEnter`, removing duplicate execution from `onMounted`.

### 3.4. `src/views/HomePage.vue`
- Added `const studentsError = ref(false);`.
- In `loadDashboardData()`, reset `studentsError.value = false` before query, and set `studentsError.value = true` on catch.
- Configured `UniStatCard` to present:
  - Value: `studentsError ? 'Unavailable' : totalStudents`
  - Meta: `studentsError ? 'Failed to load' : 'Registered'`
  - Value Color: `studentsError ? 'danger' : 'default'`

### 3.5. `src/database/repositories/students.repository.ts`
- Implemented Direct Supabase branch for `getStudentsByCanonicalSchoolId()`:
  - Queries `supabase.from('students').select('*').or(...)` with all normalized variants.
  - Returns mapped `StudentRecord[]` without leaking to SQLite.
  - Checks and throws on `error`.
- Checked `enrollmentsRes.error` and `cardsRes.error` in `getStudents()` alongside `studentsRes.error`.

---

## 4. Test Results

1. **Focused Diagnostic Tests (`tests/unit/supabase-direct-diagnostic.spec.ts`)**:
   - **8 of 8 PASSED**
   - Tested error propagation from all 4 Supabase endpoints.
   - Tested `useStudents.loadStudents()` error rethrow and reactive state preservation.
   - Tested `StudentsRepository.getStudentsByCanonicalSchoolId()` Supabase routing and avoidance of SQLite leakage.
   - Tested `StudentsRepository.getStudents()` error propagation.
   - Tested `EventService.createEvent()` raw UUID generation and payload exclusion of `description` (fixing PGRST204).
   - Tested `EventsRepository.toSupabaseEventPayload()` stripping of `evt_` prefix and exclusion of unsupported columns.
   - Tested `EventService.createOccurrence()` raw UUID generation, `evt_` parent stripping, and schema payload mapper.
   - Tested `EventsRepository.toSupabaseOccurrencePayload()` stripping of `occ_` and `evt_` prefixes.

2. **Existing Related Unit Test Suites**:
   - `tests/unit/event.service.spec.ts`: **3 of 3 PASSED**
   - `tests/unit/event-absentees-bulk-fines.spec.ts`: **12 of 12 PASSED**
   - `tests/unit/data-mode.spec.ts`: **4 of 4 PASSED**
   - `tests/unit/student.service.spec.ts`: **5 of 5 PASSED**
   - `tests/unit/student-storage.spec.ts`: **3 of 3 PASSED**
   - `tests/unit/student-server-confirmed.spec.ts`: **11 of 11 PASSED**
   - `tests/unit/theme-and-dashboard.spec.ts`: **8 of 8 PASSED**

3. **TypeScript Typecheck (`npx vue-tsc --noEmit`)**:
   - **0 errors** (Exit code 0).

4. **Production Build (`npm run build`)**:
   - **SUCCESSFUL in 16.00s** (Exit code 0).

---

## 5. Deployed RPC Mismatch Fix: `officer_get_student_activation_status`

### 5.1. Root Cause & Forward-Only Migration
- The live database RPC `officer_get_student_activation_status` was deployed with an outdated query referencing `a.performed_at` on table `public.activation_claims_audit`.
- Because `activation_claims_audit` uses column `created_at` instead of `performed_at`, calls to this function trigger PostgreSQL error `42703 (column a.performed_at does not exist)`.
- **Migration File**: `supabase/migrations/20261108120000_harden_officer_activation_status.sql`
- **Manual Deployment Status**: Staged / Ready for execution in Supabase Dashboard SQL Editor (pending manual execution by administrator; no CLI/automated execution performed).

### 5.2. Exact Remediation SQL for Supabase SQL Editor
```sql
CREATE OR REPLACE FUNCTION public.officer_get_student_activation_status(
  p_student_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student public.students%ROWTYPE;
  v_student_uuid UUID;
  v_user public.users%ROWTYPE;
  v_claim public.activation_claims%ROWTYPE;
  v_status TEXT := 'NOT_ACTIVATED';
  v_clean_id TEXT;
  v_audit JSONB := '[]'::jsonb;
BEGIN
  -- 0. Authorization check: DEVADMIN or OFFICER
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF coalesce(get_current_user_role(), '') NOT IN ('DEVADMIN', 'OFFICER') THEN
    RAISE EXCEPTION 'Unauthorized: Officer or DevAdmin privileges required.';
  END IF;

  v_clean_id := trim(coalesce(p_student_id, ''));
  IF v_clean_id = '' THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'error', 'Student identifier is required.');
  END IF;

  -- 1. Try finding student by UUID if input is formatted as UUID
  IF v_clean_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_student FROM public.students WHERE id = v_clean_id::uuid LIMIT 1;
  END IF;

  -- 2. If not found by UUID, search by canonical/flexible School ID
  IF v_student.id IS NULL THEN
    SELECT * INTO v_student FROM public.students 
    WHERE (
      lower(school_id) = lower(v_clean_id)
      OR replace(lower(school_id), '-', '') = replace(lower(v_clean_id), '-', '')
      OR id::text = v_clean_id
    )
    LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('status', 'NOT_FOUND', 'error', 'Student record not found.');
  END IF;

  v_student_uuid := v_student.id;

  -- 3. Check public.users for active student account linkage
  SELECT * INTO v_user FROM public.users 
  WHERE student_id = v_student_uuid AND account_status = 'ACTIVE'
  LIMIT 1;

  IF FOUND THEN
    v_status := 'ACTIVATED';
  ELSE
    -- 4. Check latest activation claim
    SELECT * INTO v_claim 
    FROM public.activation_claims 
    WHERE student_id = v_student_uuid 
    ORDER BY created_at DESC 
    LIMIT 1;

    IF FOUND THEN
      IF v_claim.used_at IS NOT NULL THEN
        v_status := 'ACTIVATED';
      ELSIF v_claim.revoked_at IS NOT NULL OR coalesce(v_claim.attempt_count, 0) >= coalesce(v_claim.max_attempts, 5) THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSIF v_claim.expires_at < now() THEN
        v_status := 'REQUIRES_ATTENTION';
      ELSE
        v_status := 'ACTIVATION_PENDING';
      END IF;
    ELSE
      v_status := 'NOT_ACTIVATED';
    END IF;
  END IF;

  -- 5. Collect audit trail (using valid column a.created_at)
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'action', a.action,
      'performed_at', a.created_at,
      'notes', a.notes
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_audit
  FROM public.activation_claims_audit a
  WHERE a.student_id = v_student_uuid;

  RETURN jsonb_build_object(
    'status', v_status,
    'student_id', v_student_uuid,
    'school_id', v_student.school_id,
    'claim_id', v_claim.id,
    'expires_at', v_claim.expires_at,
    'attempt_count', coalesce(v_claim.attempt_count, 0),
    'max_attempts', coalesce(v_claim.max_attempts, 5),
    'linked_user_id', v_user.id,
    'linked_username', v_user.username,
    'audit_history', v_audit
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.officer_get_student_activation_status(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.officer_get_student_activation_status(TEXT) TO authenticated;
```

---

## 6. Event Creation Direct Supabase Payload Remediation

### 6.1. Root Cause
- When creating an event in Direct Supabase mode, the payload included `description: newEvent.description || null`. The PostgreSQL `public.events` schema does not possess a `description` column, causing PostgREST error `PGRST204` (`Could not find the 'description' column of 'events' in the schema cache`).
- In addition, event IDs were generated using `generateId('evt')` (`evt_<uuid>`), which violates the PostgreSQL `UUID` primary key constraint for `events.id`.

### 6.2. Fixes Implemented
- In `src/services/event.service.ts`:
  - Replaced `generateId('evt')` with `generateUuid()`, producing a canonical raw UUID for `newEvent.id`.
  - Added explicit payload mapper `toSupabaseEventInsertPayload(event, semesterId)` which:
    - Strips any prefix if present, ensuring a valid UUID string.
    - Excludes `description` from the Supabase payload.
    - Omits non-existent columns while including only supported columns: `id`, `semester_id`, `title`, `event_type`, `audience_type`, `audience_json`, `attendance_required`, `status`, `created_at`, `updated_at`, and optionally `category_id`.
  - In `updateEvent()`, removed `description` from the Supabase update payload.
  - Preserved `newEvent.description` on the returned `Event` object for UI presentation and in `this.repo.saveEvent(newEvent)` for Offline-First SQLite persistence.
- In `src/database/repositories/events.repository.ts`:
  - Added `EventsRepository.toSupabaseEventPayload()` to map and sanitize event records for Supabase Direct mode.
  - Excluded `description` and `created_by_user_id` from the Supabase insert payload while retaining them in the SQLite `INSERT` query.

---

## 7. Events & Event Occurrences Scoped RLS Remediation

### 7.1. Root Cause & Granular Capability Model
- When an authenticated DEVADMIN or OFFICER attempts to insert an event into `public.events` in Direct Supabase mode, PostgreSQL raises error `42501: new row violates row-level security policy for table events`.
- Investigation of the archived migrations (`20261031000001_unitap_initial_schema.sql`, `20261031160000_system_setup_academic_structure.sql`, `20261101140000_officer_management.sql`) and officer capability configuration (`src/services/officer-management.service.ts`) identifies the key requirements:
  1. **DEVADMIN Role Access**: DEVADMIN users retain unrestricted event management without requiring an officer appointment.
  2. **Officer Appointment Verification**: OFFICER role access must require an active, non-expired appointment (`status = 'ACTIVE'`, `appointment_start <= now()`, `appointment_end >= now()`, `revoked_at IS NULL`, `suspended_at IS NULL`).
  3. **Granular Permissions**:
     - INSERT on `events`: Requires `events.create`.
     - UPDATE / DELETE on `events`: Requires `events.edit_assigned`.
     - INSERT on `event_occurrences`: Requires `events.create` or `events.edit_assigned` on the parent event.
     - UPDATE / DELETE on `event_occurrences`: Requires `events.edit_assigned` on the parent event.
  4. **Preset Respect & Least Privilege**:
     - `FULL`: Automatically possesses both `events.create` and `events.edit_assigned`.
     - `CUSTOM`: Validated against string permissions in `custom_permissions` JSONB (`custom_permissions ? 'events.create'`, `custom_permissions ? 'events.edit_assigned'`).
     - `ATTENDANCE`: Automatically denied event mutations (possesses only `events.view_assigned`, no `events.create` or `events.edit_assigned`).
     - `FINANCE`: Automatically denied event mutations (possesses zero event permissions).
  5. **Scope Enforcement**:
     - Creating events requires `scope_type = 'ORGANIZATION'`.
     - Managing existing events allows `scope_type = 'ORGANIZATION'` or `scope_type = 'EVENT'` (where `scope_id = events.id`).
     - Validates `semester_id` matches if restricted on the appointment.
  6. **Authenticated Reads**: Authenticated users (Officers, DevAdmins, Students) maintain read access (`SELECT`) to events and occurrences catalogs.
  7. **Catalog-Driven Policy Drops**: Dropping existing policies on `events` and `event_occurrences` is performed via `pg_policies` catalog inspection rather than guessing fictitious policy names.
  8. **Zero Anon Access**: Anonymous (`anon`) role is strictly denied all access.

- **Migration File**: `supabase/migrations/20261108130000_scoped_events_rls.sql`
- **Manual Deployment Status**: Staged / Ready for execution in Supabase Dashboard SQL Editor (pending manual execution by administrator; no CLI/automated execution performed).

### 7.2. Exact Remediation SQL for Supabase SQL Editor
```sql
-- ============================================================================
-- UniTap 2.0 Scoped Events & Event Occurrences Row Level Security (RLS)
-- File: 20261108130000_scoped_events_rls.sql
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
```

---

## 8. Event Occurrence UUID Mismatch Remediation

### 8.1. Root Cause
- When inserting an initial attendance session occurrence during event creation in Direct Supabase mode, the POST to `/rest/v1/event_occurrences` failed with PostgreSQL error `22P02: invalid input syntax for type uuid: "occ_11287077-5fa9-4560-8b71-93822dbdeb20"`.
- `EventService.createOccurrence()` generated occurrence primary keys using `generateId('occ')` (`occ_<uuid>`). While SQLite accepts arbitrary string primary keys, PostgreSQL's `public.event_occurrences` table defines `id` and `event_id` as native `UUID` columns.
- Additionally, if the parent event ID passed to `createOccurrence` retained an `evt_` prefix, PostgreSQL rejected the foreign key reference with the same `22P02` syntax error.
- In `src/views/CreateEventPage.vue`, a failure during `createOccurrence` was caught by the outer try-catch block, showing a generic creation error on the form while the parent event had already succeeded and persisted to Supabase, risking duplicate event creation on subsequent submit attempts.

### 8.2. Fixes Implemented
1. **`src/services/event.service.ts`**:
   - In `createOccurrence()`:
     - Directly generates canonical raw UUIDs using `generateUuid()` when `DataModeService.isDirectSupabase()` is active.
     - Preserves `generateId('occ')` for Offline-First SQLite operations.
     - Sanitizes `rawEventId` by stripping any leading `evt_` prefix to guarantee a clean UUID foreign key reference.
   - Added `toSupabaseOccurrenceInsertPayload()`:
     - Maps `id`, `event_id`, `title`, `occurs_on`, `starts_at`, `ends_at`, `grace_minutes`, `status`, `updated_at`, `opened_at`, and `closed_at`.
     - Automatically strips `occ_` and `evt_` prefixes if present.
   - Sanitized all occurrence query and update methods (`getOccurrences`, `getOccurrence`, `openOccurrence`, `closeOccurrence`, `getEvent`, `updateEvent`, `deleteEvent`) by stripping ID prefixes before executing Supabase queries.

2. **`src/database/repositories/events.repository.ts`**:
   - Added `EventsRepository.toSupabaseOccurrencePayload()`:
     - Sanitizes both `id` and `event_id` by stripping `occ_` and `evt_` prefixes.
     - Formats occurrence payload strictly according to Supabase schema.
   - Updated `createOccurrence()`, `updateOccurrence()`, `getOccurrencesByEventId()`, and `getOccurrenceById()` to sanitize prefixes in Direct Supabase mode.

3. **`src/views/CreateEventPage.vue`**:
   - Separated the event creation and initial occurrence creation into discrete try-catch boundaries.
   - If `createEvent` succeeds but `createOccurrence` fails, the UI notifies the user with a warning toast (`Event was saved, but its initial session failed: <error>`) and navigates to `/events/${event.id}` where the event exists, preventing duplicate submissions.

---

## 9. Student-to-Officer Promotion Architecture & Workflow Remediation

### 9.1. Problem & Root Cause
- In UniTap 2.0 `CreateOfficerPage.vue`, when selecting a registered student who already possessed an active Supabase Auth account and `users` record, the UI generated an officer activation code instead of promoting them to Officer.
- **Root Causes**:
  1. `OfficerManagementService.searchCandidates()` previously searched local SQLite first. In Direct Supabase mode, the local SQLite database had student rows but lacked remote `users` rows, resulting in `user_id: null` and `is_registered: 0`.
  2. In `CreateOfficerPage.vue`, `submitButtonLabel` checked `selectedStudent.user_id && selectedStudent.is_registered`. Because both were false/null, it defaulted to `"Issue Officer Activation Code"` and invoked `prepareImportedStudentOfficerActivation()`.
  3. No deduplication check prevented selecting a student who already held an active officer appointment.
  4. In `OfficerManagementPage.vue`, only `onMounted(loadOfficers)` was implemented. Since Ionic Vue caches page views in navigation history, returning from `CreateOfficerPage` did not trigger an automatic reload of the officers list.

### 9.2. Fixes Implemented
1. **`supabase/migrations/20261108140000_student_to_officer_promotion.sql`**:
   - Created forward-only migration defining `public.devadmin_promote_student_to_officer` RPC.
   - Enforces DEVADMIN authorization via `public.get_current_user_role()`.
   - Resolves student by raw UUID or canonical `school_id`.
   - Resolves existing user account from `users` table via `p_user_id`, `users.student_id`, or `username = school_id`.
   - Prevents duplicate active officer appointments (checks for `status IN ('ACTIVE', 'SUSPENDED')` and non-expired appointments).
   - Inserts new active officer appointment directly with `status = 'ACTIVE'`, skipping invitation codes and activation claims.
   - Grants `OFFICER` role in `user_roles` without modifying or deleting the student's existing `STUDENT` role.
   - Grants execute permission only to `authenticated` and revokes from `PUBLIC` and `anon`.

2. **`src/services/officer-management.service.ts`**:
   - Implemented `OfficerManagementService.promoteStudentToOfficer()` with Direct Supabase RPC calling `devadmin_promote_student_to_officer` and offline SQLite fallback checking duplicate appointments.
   - Made `CreateExistingStudentOfficerDto.userId` optional (`userId?: string`).
   - Aliased `assignExistingStudentAsOfficer()` to `promoteStudentToOfficer()`.
   - Updated `getOfficers()` in Direct Supabase mode to hydrate `school_id` from the `students` table.
   - Updated `searchCandidates()`: In Direct Supabase mode, queries Supabase `students`, `users`, and `officer_appointments` directly to populate `user_id`, `username`, `is_registered`, and `is_officer` accurately.

3. **`src/views/settings/CreateOfficerPage.vue`**:
   - Replaced submit button label computation so `'STUDENT'` candidates always show `'Promote to Officer'`.
   - Updated `handleSubmit()` to call `promoteStudentToOfficer()` without generating activation codes or activation claims.
   - In `selectStudent()`, added automatic hydration via `StudentActivationService.getStudentActivationStatus()` if `st.user_id` is missing.
   - Prevented duplicate active appointments: disables submit and displays duplicate officer warning banner if `selectedStudent.is_officer` is true.
   - Updated `UniDialog` success modal to show "Officer Promoted" with no activation code box for student promotions (code box preserved only for external invites).

4. **`src/views/settings/OfficerManagementPage.vue`**:
   - Added `onIonViewWillEnter(loadOfficers)` alongside `onMounted(loadOfficers)` so returning from `CreateOfficerPage` immediately refreshes the officer list.

5. **`tests/unit/supabase-direct-diagnostic.spec.ts`**:
   - Added regression test 9: verifies `OfficerManagementService.promoteStudentToOfficer()` invokes `devadmin_promote_student_to_officer` with mapped parameters.
   - Added regression test 10: verifies `OfficerManagementService.searchCandidates()` queries Supabase in Direct Mode and correctly maps `is_registered`, `user_id`, and `is_officer`.

### 9.3. Prepared Migration SQL for Manual Supabase Dashboard Execution

```sql
-- ==============================================================================
-- Migration: 20261108140000_student_to_officer_promotion.sql
-- Description:
--   Atomic Student-to-Officer Promotion RPC:
--   1. Promotes an existing authenticated student to Officer in a single transaction.
--   2. Prevents duplicate active appointments.
--   3. Automatically resolves user_id from students/users linkage if not passed.
--   4. Assigns the active appointment and OFFICER role in user_roles without altering STUDENT role.
--   5. Strictly enforces DEVADMIN authorization via public.get_current_user_role().
--   6. Does NOT create new Auth accounts or issue activation claim codes.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.devadmin_promote_student_to_officer(
  p_student_id TEXT,
  p_user_id TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_permission_preset TEXT DEFAULT 'FULL',
  p_custom_permissions JSONB DEFAULT '[]'::jsonb,
  p_academic_year_id TEXT DEFAULT NULL,
  p_semester_id TEXT DEFAULT NULL,
  p_appointment_start TIMESTAMPTZ DEFAULT now(),
  p_appointment_end TIMESTAMPTZ DEFAULT (now() + interval '1 year'),
  p_scope_type TEXT DEFAULT 'ORGANIZATION',
  p_scope_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role TEXT;
  v_student public.students%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_student_uuid UUID;
  v_user_uuid UUID;
  v_appt_id UUID;
  v_role_id UUID;
  v_clean_student_id TEXT;
  v_resolved_name TEXT;
  v_resolved_email TEXT;
BEGIN
  -- 1. Authorization: Caller must be authenticated DEVADMIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Authentication required.');
  END IF;

  v_caller_role := public.get_current_user_role();
  IF coalesce(v_caller_role, '') <> 'DEVADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Only DevAdmin can promote students to officer.');
  END IF;

  -- 2. Resolve Student Record
  v_clean_student_id := trim(coalesce(p_student_id, ''));
  IF v_clean_student_id = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student identifier is required.');
  END IF;

  IF v_clean_student_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_student FROM public.students WHERE id = v_clean_student_id::uuid LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    SELECT * INTO v_student FROM public.students 
    WHERE (
      lower(school_id) = lower(v_clean_student_id)
      OR replace(lower(school_id), '-', '') = replace(lower(v_clean_student_id), '-', '')
    )
    LIMIT 1;
  END IF;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Student record not found.');
  END IF;

  v_student_uuid := v_student.id;

  -- 3. Resolve Existing Authenticated User Account
  -- 3a. If p_user_id passed as valid UUID, verify in users
  IF p_user_id IS NOT NULL AND trim(p_user_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_user FROM public.users WHERE id = trim(p_user_id)::uuid LIMIT 1;
  END IF;

  -- 3b. If not found by p_user_id, look up by student_id foreign key
  IF v_user.id IS NULL THEN
    SELECT * INTO v_user FROM public.users 
    WHERE student_id = v_student_uuid AND account_status = 'ACTIVE' 
    LIMIT 1;
  END IF;

  -- 3c. If not found, check by username matching school_id
  IF v_user.id IS NULL THEN
    SELECT * INTO v_user FROM public.users 
    WHERE (lower(username) = lower(v_student.school_id) OR replace(lower(username), '-', '') = replace(lower(v_student.school_id), '-', ''))
      AND account_status = 'ACTIVE'
    LIMIT 1;
  END IF;

  IF v_user.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'No active user account found for student ' || v_student.school_id || '. The student must activate their account before promotion.'
    );
  END IF;

  v_user_uuid := v_user.id;

  -- Ensure student_id on user record is properly linked
  IF v_user.student_id IS NULL OR v_user.student_id <> v_student_uuid THEN
    UPDATE public.users SET student_id = v_student_uuid, updated_at = now() WHERE id = v_user_uuid;
  END IF;

  -- 4. Prevent duplicate active officer appointments
  IF EXISTS (
    SELECT 1 FROM public.officer_appointments
    WHERE (user_id = v_user_uuid OR student_id = v_student_uuid)
      AND status IN ('ACTIVE', 'SUSPENDED')
      AND appointment_end >= now()
      AND revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'Student ' || v_student.school_id || ' already has an active officer appointment.'
    );
  END IF;

  -- 5. Prepare Full Name & Email
  v_resolved_name := trim(coalesce(p_full_name, ''));
  IF v_resolved_name = '' THEN
    v_resolved_name := trim(v_student.first_name || ' ' || coalesce(v_student.last_name, ''));
  END IF;

  v_resolved_email := trim(coalesce(p_email, ''));
  IF v_resolved_email = '' OR v_resolved_email NOT LIKE '%@%' THEN
    v_resolved_email := lower(v_student.school_id) || '@univ.edu';
  END IF;

  -- 6. Insert new ACTIVE officer appointment (NO activation code, NO pending status)
  INSERT INTO public.officer_appointments (
    user_id,
    student_id,
    full_name,
    email,
    permission_preset,
    custom_permissions,
    academic_year_id,
    semester_id,
    appointment_start,
    appointment_end,
    scope_type,
    scope_id,
    status,
    assigned_by_user_id,
    created_at,
    updated_at
  ) VALUES (
    v_user_uuid,
    v_student_uuid,
    v_resolved_name,
    v_resolved_email,
    coalesce(nullif(p_permission_preset, ''), 'FULL'),
    coalesce(p_custom_permissions, '[]'::jsonb),
    p_academic_year_id,
    p_semester_id,
    coalesce(p_appointment_start, now()),
    coalesce(p_appointment_end, now() + interval '1 year'),
    coalesce(nullif(p_scope_type, ''), 'ORGANIZATION'),
    p_scope_id,
    'ACTIVE',
    auth.uid(),
    now(),
    now()
  ) RETURNING id INTO v_appt_id;

  -- 7. Assign OFFICER role in user_roles without altering existing STUDENT role
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user_uuid AND role = 'OFFICER' AND revoked_at IS NULL
  ) THEN
    INSERT INTO public.user_roles (
      user_id,
      role,
      semester_id,
      assigned_by_user_id,
      assigned_at
    ) VALUES (
      v_user_uuid,
      'OFFICER',
      p_semester_id,
      auth.uid(),
      now()
    ) RETURNING id INTO v_role_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appt_id,
    'user_id', v_user_uuid,
    'student_id', v_student_uuid,
    'officer_name', v_resolved_name,
    'status', 'ACTIVE'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.devadmin_promote_student_to_officer(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.devadmin_promote_student_to_officer(
  TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
) TO authenticated;
```

---

## 10. Supabase Endpoint Reachability Probe (`HEAD /rest/v1/`) 401 Remediation

### 10.1. Exact Request Trace and Root Cause
1. **Request Trace**:
   - The probe originated from `NetworkService.checkServerReachability()` in `src/services/network.service.ts`:
     ```ts
     const response = await fetch(`${supabaseUrl}/rest/v1/`, {
       method: 'HEAD',
       signal: controller.signal,
       headers: {
         apikey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
       },
     });
     ```
   - This method is invoked by `OperationPolicyService.evaluateOperation()` at line 98:
     ```ts
     const isReachable = await NetworkService.checkServerReachability(2500);
     ```
   - Every mutation guard (`assertPermitted()`) and policy evaluation for `ONLINE_CONFIRMED` operations executed this bare fetch.

2. **Why the HEAD Probe Returned 401 Unauthorized**:
   - **OpenAPI Schema Protection**: In Supabase's API gateway architecture, the root PostgREST path `/rest/v1/` serves the OpenAPI schema definitions for the entire database. Supabase strictly requires a Secret API Key for this endpoint (`{"message":"Secret API key required","hint":"Only secret API keys can be used for this endpoint."}`, returning `sb-error-code: UNAUTHORIZED_INVALID_API_KEY_TYPE`). Publishable / anon keys are rejected with HTTP 401 Unauthorized.
   - **Omitted Authorization Headers**: The bare `fetch` call did not use the configured Supabase client and omitted the `Authorization: Bearer <token>` header entirely.
   - **Why Working INSERT/RPC Requests Succeed**:
     - Working application requests (e.g. `POST /rest/v1/events`, `POST /rest/v1/rpc/devadmin_promote_student_to_officer`) route through the configured `@supabase/supabase-js` client instance (`@/integrations/supabase/client`).
     - The client automatically attaches both `apikey` and `Authorization: Bearer <session.access_token>`.
     - These requests target specific table and RPC endpoints (`/rest/v1/<table_name>`, `/rest/v1/rpc/<rpc_name>`) rather than the root schema `/rest/v1/`, which are explicitly permitted for client roles subject to RLS and database grants.

### 10.2. Minimal Fix Implemented
- In `src/services/network.service.ts`:
  - Replaced the bare `fetch` to `/rest/v1/` with an authenticated, lightweight connectivity check via the configured Supabase client using `supabase.rpc('get_current_user_role')`.
  - Used `Promise.race` and `AbortController` signal to guarantee the probe terminates within `timeoutMs` (defaults to 3000ms, or 2500ms when called from `OperationPolicyService`).
  - Added compatibility checks so test mocks returning direct Promises or `{ data: null, error: null }` resolve cleanly without requiring `.abortSignal`.
  - Added regression test 11 in `tests/unit/supabase-direct-diagnostic.spec.ts` verifying that `checkServerReachability` calls `get_current_user_role` and never issues raw `HEAD /rest/v1/` fetch requests.

---

## 11. Direct Supabase Contribution Student Assignment & Blocking Processing UI Remediation

### 11.1. Issue Description & Root Cause
1. **Empty `student_obligations` on Contribution Creation**:
   - When creating a contribution in Direct Supabase mode, `FinanceService.createContributionCollection()` successfully inserted a fee definition into `public.obligation_rules`.
   - However, no individual student obligations were created in `public.student_obligations`.
   - **Root Cause**: `FinanceRepository.assessBulkContributions()` lacked a `DataModeService.isDirectSupabase()` execution branch. It was unconditionally executing queries against the local SQLite database adapter (`getDatabase()`). Since SQLite has no student records populated in Direct Supabase mode, zero students were identified and zero obligation records were generated or inserted into Supabase Cloud.
2. **PostgreSQL Column Type Incompatibility (`batch_id`)**:
   - In PostgreSQL schema `public.student_obligations`, `batch_id` is defined as `UUID`.
   - The legacy SQLite implementation generated string IDs prefixed with `'batch_c_' + ...`, which would cause PostgreSQL error `22P02: invalid input syntax for type uuid` if dispatched directly.
3. **Filtering Masked Non-Active Obligations**:
   - In `FinanceRepository.getObligationsBySemester()`, querying with `.eq('status', 'ACTIVE')` hid student obligations that transitioned to `PARTIAL` or `PAID`, skewing collection summary and target totals.
4. **Lack of User Feedback & Partial-Failure Vulnerability**:
   - `ContributionsPage.vue` lacked a blocking modal during the multi-step contribution creation and student assignment process.
   - If network degradation or RLS errors interrupted student assignment after `obligation_rules` was already committed, the user was left with no clear status, and retrying would recreate duplicate fee definition rules.

### 11.2. Architecture & Code Changes Implemented
1. **Domain Types & Progress Pipeline (`src/types/finance.ts`)**:
   - Added `existingRuleId?: string` to `CreateContributionCollectionParams` to allow idempotent retry of student assignment against an already-created rule.
   - Exported `ContributionCreationStage` union:
     ```ts
     export type ContributionCreationStage =
       | 'CREATING_RULE'
       | 'LOADING_STUDENTS'
       | 'GENERATING_OBLIGATIONS'
       | 'SAVING_SUPABASE'
       | 'FINALIZING'
       | 'SUCCESS'
       | 'ERROR';
     ```
2. **Direct Supabase Repository Assessment (`src/database/repositories/finance.repository.ts`)**:
   - Implemented a complete `DataModeService.isDirectSupabase()` branch inside `FinanceRepository.assessBulkContributions()`:
     - Directly queries Supabase tables `student_enrollments` and `students` based on the targeted scope (`ALL`, `PROGRAM`, `YEAR_LEVEL`, `SECTION`, or `INDIVIDUAL`).
     - Queries existing `student_obligations` for the given `rule_id` and `semester_id` where `status != 'VOID'` to deduplicate students who already have an obligation assigned.
     - Generates raw UUIDs for `id` and `batch_id` (via `FinanceRepository.generateUuid()`) with zero `batch_c_` prefixes.
     - Maps rows strictly to supported columns: `id`, `student_id`, `semester_id`, `rule_id`, `title`, `type ('CONTRIBUTION')`, `amount_centavos`, `status ('ACTIVE')`, `due_date`, `issued_by_user_id`, `batch_id`, `issued_at`, and `updated_at`.
     - Chunks Supabase `insert` queries into batches of 100 to respect Supabase payload boundaries and avoid timeouts on large cohorts.
     - Updates `getObligationsBySemester()` to filter `.neq('status', 'VOID')` rather than `.eq('status', 'ACTIVE')`, ensuring full collection tracking across `ACTIVE`, `PARTIAL`, and `PAID` statuses.
3. **Service Orchestration & Idempotent Retry (`src/services/finance.service.ts`)**:
   - Added `getRuleById(id: string)` with Direct Supabase and SQLite fallback.
   - Updated `createContributionCollection()`:
     - Accepts an optional `onProgress: (stage: ContributionCreationStage, meta?: any) => void` callback.
     - If `params.existingRuleId` is supplied, skips `createRule()` and fetches the existing rule directly, preventing duplicate fee rules.
     - Wraps `assessBulkContributions()` in a targeted try/catch: if assignment fails after rule creation, catches the error, sets `res.ruleSaved = true` and `res.savedRule = rule`, allowing the UI to present a targeted retry mechanism.
4. **Blocking Processing UI (`src/views/ContributionsPage.vue`)**:
   - Implemented a full-screen blocking modal `<ion-modal class="blocking-process-modal" :is-open="isBlockingModalOpen">` adhering to the design patterns established in `CsvImportPage.vue`.
   - Features:
     - Real-time animated progress bar (`creationProgressCurrent` / `creationProgressTotal`).
     - Animated stage icon and spinner.
     - Context card displaying Contribution Title, Academic Semester, Target Amount, and Eligible Student Count.
     - Error state handling with explicit differentiation: if the rule was saved but student assignment failed, provides a "Retry Student Assignment" button calling `handleCreateContribution(createdRuleRecord.id)` without duplicating the rule, as well as a "Dismiss & Keep Rule" option.
     - Prevents premature navigation, accidental dismissal, or concurrent creation clicks.

### 11.3. Verification Results
- **Unit Tests**:
  - Added tests 12, 13, and 14 to `tests/unit/supabase-direct-diagnostic.spec.ts` covering Direct Supabase bulk contribution assessment, deduplication, and retry flow.
  - Ran Vitest suite:
    - `tests/unit/supabase-direct-diagnostic.spec.ts` (14 tests passed).
    - `tests/unit/continuous-finance-recording.spec.ts` (17 tests passed).
    - **Total: 31 passed, 0 failed**.
- **Typecheck**:
  - `npx vue-tsc --noEmit` exited with code `0`.
- **Production Build**:
  - `npm run build` completed successfully in 17.3s (`dist/assets/ContributionsPage-*.js`, `dist/assets/finance.service-*.js`, `dist/assets/finance.repository-*.js`).

---

## 12. Fix `student_obligations` RLS Policy for Direct Supabase Contribution Assignment

### 12.1. Root Cause Analysis
- **Problem**: When assigning students to a newly created contribution fee definition in Direct Supabase mode, the batch insert into `public.student_obligations` is evaluated against PostgreSQL Row-Level Security.
- **Root Cause**:
  - Migration `supabase/migrations/20261101000000_student_activation_and_rls.sql` defined:
    ```sql
    CREATE POLICY "Officers manage student obligations" ON student_obligations
      FOR ALL USING (
        EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
      );
    ```
  - The direct subquery against `public.user_roles` inside the RLS policy encounters the RLS policies of `user_roles` itself. When an authenticated user performs bulk inserts, this direct subquery can be blocked, return 0 rows, or cause infinite recursion, triggering `42501: new row violates row-level security policy for table student_obligations`.
  - Furthermore, it lacked an explicit `WITH CHECK` clause matching the `USING` predicate.

### 12.2. Forward-Only Migration (`20261108150000_fix_student_obligations_rls.sql`)
The policy is updated to use the existing `SECURITY DEFINER` helper `public.get_current_user_role()`, which bypasses RLS on `user_roles` in a sandboxed, trusted context:
```sql
-- ==============================================================================
-- UniTap Migration: Fix student_obligations RLS for Direct Supabase Mode
-- Migration File: supabase/migrations/20261108150000_fix_student_obligations_rls.sql
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
```

---

## 13. Contribution Creation Sheet & Modal Lifecycle Remediation

### 13.1. Issue Description & Root Cause
- **Issue**:
  - After a contribution fee and student obligations were successfully confirmed and written to Supabase Cloud, the Success modal was presented.
  - However, the underlying "Create Contribution" sheet (`UniSheet`) remained open in the DOM and did not dismiss correctly.
- **Root Cause**:
  - The blocking processing modal (`isBlockingModalOpen`) was doing double duty, presenting both in-flight processing and confirmed success.
  - While processing was underway, `isCreateCollectionSheetOpen` was intentionally kept open to preserve form inputs in case of failure.
  - When Supabase confirmed success, `isCreateCollectionSheetOpen` was not dismissed prior to showing the success state.
  - Furthermore, having an active `UniSheet` (which applies `overflow: hidden` and body stack handlers) and an active `ion-modal` stacked simultaneously prevented clean dismiss animations and caused the underlying sheet to remain stuck or backdrop-locked when closing.

### 13.2. Lifecycle Fix Implemented (`src/views/ContributionsPage.vue`)
1. **Separated Modal States**:
   - `isBlockingModalOpen`: Dedicated strictly to active processing (`CREATING_RULE`, `LOADING_STUDENTS`, `GENERATING_OBLIGATIONS`, `SAVING_SUPABASE`, `FINALIZING`) and error handling (`ERROR`).
   - `isSuccessModalOpen`: Dedicated strictly to confirmed Supabase success (`SUCCESS`).
2. **Explicit Sequential Modal Dismissal**:
   - When Supabase confirms success:
     ```ts
     // 1. After confirmed Supabase success, close and dismiss the Create Contribution sheet
     isCreateCollectionSheetOpen.value = false;

     // 2. Close the blocking processing modal before displaying the success modal
     isBlockingModalOpen.value = false;

     // 3. Prevent stacked or overlapping Ionic modals by yielding for dismiss transition
     await new Promise((resolve) => setTimeout(resolve, 150));

     // 4. Display the dedicated success modal
     isSuccessModalOpen.value = true;
     ```
3. **Confirmed Success Handler**:
   - "Done & View Collections" invokes `handleFinishCreationSuccess()`:
     - Dismisses `isSuccessModalOpen.value = false;`
     - Dismisses `isCreateCollectionSheetOpen.value = false;`
     - Clears form inputs (`collectionName`, `collectionNotes`, `selectedStudentIds`).
     - Refreshes collections via `await loadData();`
     - Switches view to Collections tab: `activeSection.value = 'COLLECTIONS';`
4. **Preserved Cancel and Failure States**:
   - The sheet is never dismissed before Supabase confirms success (protecting input if a network error occurs).
   - Cancel on the sheet cleanly closes `isCreateCollectionSheetOpen = false`.
   - On error, `isCreateCollectionSheetOpen` remains open in the background while the blocking modal displays error details and options to "Retry Student Assignment" or "Close".

### 13.3. Verification Results
- **Unit Tests**: `npx vitest run tests/unit/supabase-direct-diagnostic.spec.ts tests/unit/continuous-finance-recording.spec.ts` (31 passed, 0 failed).
- **Typecheck**: `npx vue-tsc --noEmit` (0 errors, exit code 0).
- **Production Build**: `npm run build` (built in 18.6s, exit code 0).

---

## 14. Student UI Remediation: Contributions Year/Section Mapping & Student Portal Profile

### 14.1. Issue Description & Root Causes
1. **Contributions Year/Section Display**:
   - **Symptom**: On the Contributions Page under "Student Records", student obligations displayed academic placeholders like `Year 1-N/A` and generic titles instead of the student's real year level, section, and program.
   - **Root Cause**: `FinanceRepository.getObligationsBySemester()` in Direct Supabase mode joined `students` but not `student_enrollments` or `programs`, defaulting unpopulated columns to `year_level: 1` and `section: '1A'`. Additionally, `FinanceService.getObligationsBySemester()` was not populating the academic details from `StudentService` (which already had cached, authoritative student enrollments used by the Students directory page).

2. **Student Portal Profile Resolution**:
   - **Symptom**: When a student logged into the Student Portal in Direct Supabase mode, the dashboard displayed placeholder text like `"MCC STUDENT"` and generic year/section info, or failed to hydrate the profile.
   - **Root Cause**: `useCurrentStudentPortal.ts` previously attempted to resolve students from the local SQLite database via `StudentStorageService.getStudentById()`. In Direct Supabase mode, local SQLite does not contain the remote student or user session linkage. The Supabase auth user (`supabase.auth.getUser()`) has an ID corresponding to `public.users.id`, which points to `student_id` (a UUID foreign key to `public.students.id`). If this linkage was not queried from Supabase, the student profile could not be loaded.

### 14.2. Fixes Implemented

1. **`src/types/finance.ts` & `src/database/repositories/finance.repository.ts`**:
   - Added `course?: string` and `program?: string` to `StudentObligationItem` and `StudentObligationWithBalance`.
   - Updated `FinanceRepository.getStudentObligations` to filter using `.neq('status', 'VOID')` rather than `.eq('status', 'ACTIVE')` so partial/paid/unpaid records are included.
   - Updated `FinanceRepository.getObligationsBySemester` in Direct Supabase mode to query `programs` and respect student enrollment details rather than hardcoding fallback strings.

2. **`src/services/finance.service.ts`**:
   - Reused the existing authoritative `StudentService` student-and-enrollment cache in `FinanceService.getObligationsBySemester()`.
   - In Direct Supabase mode, calls `await studentService.getStudents()` and matches each obligation's `student_id` to the student's authoritative record, populating:
     - `studentName` (formatted as `Last, First`)
     - `schoolId` (from student record)
     - `yearLevel` (from active enrollment)
     - `section` (from active enrollment)
     - `course` & `program` (program code, e.g., `BSIT`)
   - Preserves `course` and `program` across all mapped obligation items.

3. **`src/views/ContributionsPage.vue`**:
   - In `loadData()`, replaced direct repository query with `studentService.getStudents()`, populating `enrolledStudents` with `id`, `school_id`, `first_name`, `last_name`, `status`, `created_at`, `updated_at`, `year_level`, `section`, and `program_id`.
   - Updated the Student Records list item subtitle binding to display:
     `:subtitle="`${c.schoolId || 'No ID'} • ${c.program || c.course || 'BSIT'} • Year ${c.yearLevel || 1}-${c.section || 'N/A'} • ${c.title}`"`.

4. **`src/composables/useCurrentStudentPortal.ts`**:
   - Added direct Supabase resolution path to `resolveCurrentStudent()`:
     1. Resolves authenticated Supabase Auth user via `supabase.auth.getUser()`.
     2. Queries `public.users` table for `student_id` and `username`.
     3. Queries `studentService.getStudent(userRow.student_id)` (or searches by username/School ID) to fetch the complete academic profile, enrollment, and active NFC card.
     4. Sets `error.value = 'No student profile is linked to this authenticated account.'` if no student record matches.
   - Updated `studentName` computed property to return `''` when no profile is linked instead of generic fallback `'Student'`.

5. **`src/components/student/StudentHomeView.vue`**:
   - Replaced `'MCC STUDENT'` generic placeholder with the student's actual student number (`student?.studentNumber`).
   - Added an unlinked account state using `UniEmptyState` with a "Retry Connection" action if the profile fails to resolve.
   - Added loading skeleton/spinner state during profile hydration.

6. **`tests/unit/supabase-direct-diagnostic.spec.ts`**:
   - Added Regression Test 15: verifies that `FinanceService.getObligationsBySemester` maps student name, School ID, program, year level, and section accurately in Direct Supabase mode without fallback defaults.
   - Added Regression Test 16: verifies that `useCurrentStudentPortal` resolves `student_id` from `public.users` and loads complete profile via `StudentService`.

### 14.3. Verification Results
- **Unit Tests**:
  - `tests/unit/supabase-direct-diagnostic.spec.ts`: 16 passed (including tests 15 and 16).
  - `tests/unit/continuous-finance-recording.spec.ts`: 17 passed.
  - Total: 33 tests passed, 0 failed.
- **Typecheck**: `npx vue-tsc --noEmit` passed with 0 errors (exit code 0).
- **Production Build**: `npm run build` completed in 22.16s with 0 errors (exit code 0).

---

## 15. DEVADMIN Deletion Architecture & Automatic Cascades

### 15.1. Background & Problem Statement
Prior to this update, parent records across UniTap (such as obligation rules, events, students, and academic structure) could not be cleaned up cleanly in Direct Supabase mode due to foreign key constraint violations, lack of DEVADMIN-level delete controls, and missing UI delete triggers. Furthermore, financial integrity requires that records with actual collected payments or payment allocations must NEVER be destructively deleted, but instead protected with descriptive error guidance directing administrators to safe archiving or deactivation.

### 15.2. Architecture & Remediation Strategy

1. **Database CASCADE & BEFORE DELETE Protection Triggers**:
   - `student_obligations`: Added `ON DELETE CASCADE` on `rule_id` foreign key.
   - `obligation_rules`: Added trigger `trg_protect_obligation_rule_deletion` that blocks deletion with error `42501` if child student obligations have recorded payment allocations (`Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.`). Unpaid obligations are safely cascaded.
   - `student_obligations`: Added trigger `trg_protect_student_obligation_deletion` that blocks deletion if payment allocations exist (`Cannot delete student obligation because payments have already been allocated to it.`).
   - `events`: Added trigger `trg_protect_event_deletion` that verifies if paid absence fines exist before deletion (`Cannot delete event because paid absence fines have already been collected for it.`); automatically cascades and cleans up unpaid absence fines.
   - `students`: Added trigger `trg_protect_student_deletion` that blocks deletion if immutable ledger payments or allocations exist (`Cannot delete student record with historical ledger payment transactions.`).
   - `academic_years` and `semesters`: Added triggers blocking deletion if active payments are linked to obligations within those terms.

2. **Supabase RLS Policy Hardening**:
   - Strictly restricted `DELETE` operations across all core entities (`students`, `student_enrollments`, `nfc_cards`, `obligation_rules`, `student_obligations`, `events`, `event_occurrences`, `programs`) to DEVADMIN users via `public.get_current_user_role() = 'DEVADMIN'`.
   - Prevented standard `OFFICER` roles from executing unauthorized remote `DELETE` operations even if attempting raw PostgREST requests.

3. **Front-End DEVADMIN-Only Deletion UX**:
   - Extended `useAuth()` with reactive computed flags: `isDevAdmin` and `isOfficer`.
   - Added standard destructive confirmation dialogs (`UniDialog`) with target record details, loading feedback states (`isDeleting...`), error toasts, and post-delete data refreshes across all management screens:
     - **Students**: Delete Student button in `StudentProfilePage.vue` (DEVADMIN-only).
     - **NFC Cards**: Delete Card chip action in `StudentProfilePage.vue` (DEVADMIN-only).
     - **Academic Years**: Delete Year button in `AcademicYearsPage.vue` (DEVADMIN-only).
     - **Semesters**: Delete Semester button in `SemestersPage.vue` (DEVADMIN-only).
     - **Sections**: Delete Section button in `SectionsPage.vue` (DEVADMIN-only).
     - **Programs**: Delete Program button in `ProgramsPage.vue` (DEVADMIN-only).
     - **Event Categories**: Delete Category button in `EventCategoriesPage.vue` (DEVADMIN-only).
     - **Events**: Delete Event button in `EventDetailPage.vue` (DEVADMIN-only).
     - **Contributions**: Delete Collection button on collection cards and Delete Dues button on student records (when no payments made) in `ContributionsPage.vue` (DEVADMIN-only).
     - **Fines**: Delete Fine button in `FinesPage.vue` (when balance equals total amount, indicating no payments made) (DEVADMIN-only).
     - **Officer Management**: Delete Appointment button in `OfficerManagementPage.vue` (DEVADMIN-only).

4. **Service & Repository Direct Remote Operations**:
   - `StudentService.deleteStudent()`: Performs remote `supabase.from('students').delete().eq('id', id)`.
   - `StudentService.deleteNfcCard()`: Added and exported for card management.
   - `SystemSetupService.deleteAcademicYear()` & `deleteSemester()`: Validates DEVADMIN role and performs remote deletes.
   - `FinanceService.deleteObligationRule()`, `deactivateObligationRule()`, `deleteStudentObligation()`: Implemented with `FINANCE_ASSESSMENTS_AND_RULES` policy enforcement and remote Supabase deletes.

### 15.3. Migration File Created
- **File**: `supabase/migrations/20261108160000_devadmin_cascades_and_delete_protection.sql`
- **Deployment Status**: DEPLOYED (user-confirmed). Executed manually via Supabase Dashboard SQL Editor on November 8, 2026.

### 15.4. Verification Results
- **Unit Tests**:
  - `tests/unit/supabase-direct-diagnostic.spec.ts`: 18 tests passed (including Test 17: DEVADMIN remote delete & Test 18: Non-DEVADMIN delete rejection).
  - `tests/unit/continuous-finance-recording.spec.ts`: 17 tests passed.
  - Total: 35 passing tests, 0 failed.
- **Typecheck**: `npx vue-tsc --noEmit` passed with 0 errors (exit code 0).
- **Production Build**: `npm run build` completed in 20.08s with 0 errors (exit code 0).

---

## 16. Polish of Contributions Page Academic Display & Student Portal Resolution

### 16.1. Problem Statement
1. **Contributions Page Hardcoded Fallbacks**:
   - `ContributionsPage.vue` was defaulting missing course/program to `'BSIT'` and missing year level to `1`, which misled officers by showing incorrect academic levels when students were unenrolled or in a different program.
   - Individual student rows in the collection creation modal also defaulted year level to `1` and section to `'N/A'`.
2. **Student Portal Account Resolution & ID Discrepancies**:
   - When `public.users.student_id` was `NULL`, the portal previously tried resolving the student by splitting the user's email address by `@` (`email.split('@')[0]`), which was error-prone and incorrect.
   - Risk existed where the auth account UUID could be mistakenly substituted for the student's domain entity UUID (`students.id`), which broke database foreign keys.

### 16.2. Remediation Implemented

1. **`ContributionsPage.vue` Display Polish**:
   - Removed misleading fallbacks `'BSIT'` and `yearLevel || 1`.
   - Updated obligation record subtitle and student row subtitle to display actual enrollment data or a clean dash `—` when missing:
     - School ID: `c.schoolId || '—'`
     - Program: `c.program || c.course || '—'`
     - Year & Section: `formatObligationAcademicSubtitle()` accurately outputs `Year {yearLevel}-{section}`, `Year {yearLevel}`, or `—`.
     - In the Create Collection student picker: `<span class="stu-sub font-mono">{{ s.school_id || '—' }} • {{ formatStudentYearSection(s) }}</span>`.

2. **`useCurrentStudentPortal.ts` Exact Metadata Resolution & Link Repair**:
   - Completely eliminated email username splitting (`email.split('@')[0]`) and removed all email-based student lookups.
   - If `public.users.student_id` is `NULL`, resolves the student strictly by matching the authenticated user's exact `authData.user.user_metadata.school_id` against `students.school_id`.
   - Requires an exact, case-insensitive verified match (`matchedStudent.studentNumber.trim().toUpperCase() === metadataSchoolId.toUpperCase()`).
   - Only after an exact verified match, repairs `public.users.student_id` by executing a targeted update with the student's entity UUID (`candidate.id`).
   - Enforced strict protection against substituting auth UUID for student UUID across all resolution branches (`student_id !== authUid` and `candidate.id !== authUid`).

3. **Regression Tests Added**:
   - Added Test 19 to `tests/unit/supabase-direct-diagnostic.spec.ts`: Validates that `useCurrentStudentPortal` resolves student via `user_metadata.school_id` when `public.users.student_id` is `NULL`, repairs `public.users` with student UUID (not auth UUID), and maps academic details properly.
   - Added Test 20 to `tests/unit/supabase-direct-diagnostic.spec.ts`: Validates that `useCurrentStudentPortal` refuses to treat email usernames as School ID when metadata is absent or unlinked, returning `null` with a clear "Profile Unlinked" error.

### 16.3. Verification Results
- **Unit Tests**:
  - `tests/unit/supabase-direct-diagnostic.spec.ts`: 20 tests passed.
  - `tests/unit/continuous-finance-recording.spec.ts`: 17 tests passed.
  - Total: 37 passing tests, 0 failed.
- **Typecheck**: `npx vue-tsc --noEmit` passed with 0 errors (exit code 0).
- **Production Build**: `npm run build` completed in 26.39s with 0 errors (exit code 0).

---

## 17. Configurable Attendance IN/OUT & Student Profile Photos

### 17.1. Architecture & Capabilities

1. **Configurable Attendance Checkpoints per Event Occurrence**:
   - Event organizers (DEVADMIN / OFFICER) can configure multiple checkpoints per occurrence session (e.g. `Morning IN`, `Morning OUT`, `Afternoon IN`, `Afternoon OUT`).
   - Checkpoints define custom labels, checkpoint type (`IN` | `OUT`), start/end schedules, and order index stored in `event_occurrences.checkpoints_json` with an `active_checkpoint_id` pointer.
   - NFC scans verify and record attendance against the active checkpoint.
   - Deduplication: Attendance records enforce checkpoint-scoped uniqueness (`UNIQUE (occurrence_id, student_id, checkpoint_id)`). A student who has checked in for `Morning IN` is marked as duplicate only if scanned again for `Morning IN`, but can cleanly check in for `Morning OUT` without conflict.
   - Attendance reports: Added `ReportService.generateAttendanceCsv()` and an "Export CSV" feature in `EventDetailPage.vue` allowing organizers to export checkpoint completion across all students.

2. **Student Profile Photos & Supabase Storage Integration**:
   - Integrated Supabase Storage with dedicated public bucket `student-profile-photos`.
   - Security policies grant public `SELECT` access, while upload/update/delete are restricted to authenticated DEVADMIN and active OFFICER roles.
   - Storage path is stored in `students.photo_storage_path`.
   - Public photo URLs are resolved with high-performance in-memory caching (`StudentService.photoUrlCache`) to avoid redundant storage API requests.
   - Photos are displayed across:
     - `AttendanceScanPage.vue` Photo Identity Verification Card.
     - `StudentProfilePage.vue` Profile Hero Card (with direct file upload / delete controls for officers).
     - `StudentCard.vue` in Students directory.
     - `StudentHomeView.vue` CSG Student Pass card.
     - `StudentPassPage.vue` Digital Pass view.
   - Default avatar with capitalized student initials fallback is displayed whenever a photo is absent.
   - Both Direct Supabase Mode and Offline-First SQLite Mode are preserved with base64 local fallback.

### 17.2. Database & Schema Updates

- **Forward-only Supabase Migration**: `supabase/migrations/20261108170000_attendance_checkpoints_and_storage.sql`
  - **Deployment Status**: DEPLOYED (user-confirmed). Executed manually via Supabase Dashboard SQL Editor on November 8, 2026.
  - Adds `checkpoints_json JSONB DEFAULT '[]'` and `active_checkpoint_id VARCHAR(64)` to `event_occurrences`.
  - Adds `checkpoint_id VARCHAR(64) DEFAULT 'default_in'` to `attendance_records`.
  - Replaces `(occurrence_id, student_id)` constraint with `UNIQUE (occurrence_id, student_id, checkpoint_id)`.
  - Upgrades `record_attendance_scan` RPC to accept `p_checkpoint_id VARCHAR(64) DEFAULT 'default_in'` and execute checkpoint-scoped duplicate checks.
  - Provisions `student-profile-photos` storage bucket with RLS policies.
- **SQLite Migration 010**: `src/database/migrations/010_attendance_checkpoints.ts`
  - Adds `checkpoints_json`, `active_checkpoint_id`, and `checkpoint_id`.

---

## 18. Scoped Student Payment Obligation Filtering (Record Payment Find Student)

### 18.1. Problem & Architecture
- Previously, the "Find Student" tab in `MakePaymentPage.vue` invoked `useStudents().loadStudents()`, fetching all 300 students regardless of whether they owed money.
- Finding eligible debtors required filtering at the query level before assembling full student profiles.

### 18.2. Implementation
- **Student Service (`src/services/student.service.ts`)**:
  - Added `getStudentsByIds(ids: string[]): Promise<Student[]>`.
  - Direct Supabase Mode queries `students`, `student_enrollments`, and `nfc_cards` with `.in('id', ids)` and joins them using `assembleStudentFromParts`.
  - SQLite Mode filters `repo.getAll()`.
- **Finance Repository (`src/database/repositories/finance.repository.ts`)**:
  - Added `FinanceRepository.getStudentIdsWithOutstandingBalance({ category, ruleId, semesterId })`.
  - Direct Supabase Mode: Queries `student_obligations` filtered by `status != 'VOID'`, category, and `rule_id`, fetches `payment_allocations` with `POSTED` payments, calculates `balance = assessed - paid`, excludes `status = 'PAID'` and fully paid balances, and returns unique student IDs with `balance > 0`.
  - Offline-First SQLite Mode: Executes equivalent CTE calculating `(o.amount_centavos + COALESCE(a.change_centavos, 0)) > COALESCE(p.paid_centavos, 0)`.
- **Finance Service (`src/services/finance.service.ts`)**:
  - Added `getEligibleStudentsForPayment({ category, ruleId, semesterId, searchQuery })`. Scopes student IDs first and assembles full Student objects.
- **Make Payment Page (`src/views/MakePaymentPage.vue`)**:
  - Replaced `useStudents()` global student loading with `eligibleStudents` and `loadEligibleStudents()`.
  - Watches `[selectedCategory, selectedRuleId]` to trigger scoped refresh whenever the category or template selection changes.
  - Automatically refreshes eligible students when switching to Find Student search tab and after successful payment recording.
  - Added empty state handling when no students owe obligations for the selected template/category.

### 18.3. Contribution Collection Deletion & UI Alignment Fix
- **Root Cause**:
  - In `ContributionsPage.vue`, deleting a collection invoked `deleteObligationRule(ruleId)`. In Direct Supabase mode, it only deleted from `obligation_rules`.
  - Because `student_obligations.rule_id` foreign key defaults to `ON DELETE SET NULL`, the 12 assigned child student obligations remained in the database with `rule_id = NULL`.
  - Upon reloading, `getContributionCollections()` detected the unlinked student obligations and re-grouped them under `legacy_test`, making it appear that delete did nothing. Furthermore, subsequent delete calls failed because `legacy_test` is not a valid UUID.
  - Squeezed 4 buttons (`Record Payment`, `View Students`, text `Delete`, and `(i)`) into one row caused awkward button truncation and visual crowding.
- **Fix**:
  - Implemented `financeService.deleteContributionCollection(col)` which safely checks for existing payments in `payment_allocations`. If 0 payments exist, it deletes all assigned child `student_obligations` first, and then deletes the parent `obligation_rules` record. Works for both canonical UUID collections and legacy unlinked collections.
  - Also updated `deleteStudentObligation(obligationId)` to check for payment allocations before deleting.
  - Restyled `collection-card-actions`: Primary operational actions (`Record Payment` and `View Students`) take `flex: 1`, while secondary actions (`(i)` Details and `🗑` Delete) are clean, responsive 36x36 icon action buttons with clear danger styling (`#ef4444`) and tooltips.
  - Added a Delete button inside the Collection Details sheet for convenient management.

### 18.4. Final Corrective Pass: Atomicity, Security & Photo Hardening
- **Contribution Deletion Atomicity**:
  - Migrated Direct Supabase collection deletion to leverage database foreign-key `ON DELETE CASCADE` backed by PostgreSQL `BEFORE DELETE` triggers.
  - Deleting an `obligation_rules` parent record triggers `trg_protect_obligation_rule_deletion`, which aborts atomically if any payments have been collected. If zero payments exist, Postgres cascades child obligation cleanup in a single transaction.
  - Legacy unlinked collections safely target only matching records with `rule_id IS NULL` without sending synthetic strings like `legacy_test` to UUID columns.
- **Immutable Financial & Audit Records**:
  - Added explicit database triggers preventing deletion of `payments`, `payment_allocations`, `attendance_audit`, and `audit_logs`.
  - Dropped all legacy `FOR ALL` policies on financial ledger tables and replaced them with command-specific `SELECT` and `INSERT` policies.
- **Hardened Attendance Checkpoint RPC**:
  - Upgraded `record_attendance_scan` in `20261108170000_attendance_checkpoints_and_storage.sql` to require non-null `auth.uid()`, use `COALESCE(v_role, '') NOT IN ('DEVADMIN', 'OFFICER')`, and preserve full officer appointment, active window, and scope checks.
  - Validates that `p_checkpoint_id` belongs to occurrence's configured `checkpoints_json`, enforces matching against `active_checkpoint_id`, and logs either `CHECK_IN` or `CHECK_OUT` in `attendance_audit` depending on checkpoint type.
- **Private Profile Photos & Signed URL Lifecycle**:
  - Configured `student-profile-photos` storage bucket as strictly PRIVATE (`public = false`).
  - Added authenticated RLS allowing Officers/DevAdmin to manage photos, and enrolled students to read their own photo (`name LIKE (student_id || '/%')`).
  - Replaced `getPublicUrl()` with secure 1-hour signed URL generation (`createSignedUrl`, `createSignedUrls`) and 3500-second in-memory caching.
- **Outstanding Balance Consistency**:
  - Updated `FinanceRepository.getStudentIdsWithOutstandingBalance` in Direct Supabase mode to query `obligation_adjustments` and compute net assessed amount and remaining balance with batched queries, matching SQLite offline-first calculation.

### 18.5. Delete Collection Confirmation Modal & Resilient Two-Phase Deletion
- **Issue**:
  - In `ContributionsPage.vue`, clicking the red trash icon rendered confirmation text inline below the contribution card in the page flow rather than in a centered modal overlay. Confirm and Cancel buttons were missing because `UniDialog` was missing from the component imports list in `ContributionsPage.vue`, causing the browser to treat `<UniDialog>` as an unknown inline custom HTML element.
  - Furthermore, `UniDialog.vue` previously lacked a `:loading` prop and automatically emitted `update:isOpen = false` on confirm, which would close asynchronous deletion modals prematurely before Supabase operations succeeded or reported errors.
- **Fix**:
  - **Component Import & Overlay Teleportation (`ContributionsPage.vue`)**:
    - Added `UniDialog` to the `@/components/ui` import list in `ContributionsPage.vue`, restoring full Vue `<Teleport to="body">` modal overlay rendering and centered backdrop behavior.
  - **Asynchronous Modal Controls & Protection (`UniDialog.vue`)**:
    - Added `:loading` and `:prevent-auto-close` props to `UniDialog.vue`.
    - When `:loading` is true:
      - Confirm button displays `ion-spinner` and both Cancel and Confirm buttons are disabled.
      - Backdrop clicks (`handleCancel`), Escape keydown, and mobile hardware back-button dismissals are completely ignored while deletion is in progress.
    - When `:prevent-auto-close` is true:
      - The dialog does not automatically close on confirm; it remains open until the parent component explicitly closes it after confirmed database success.
  - **Failure Preservation & Error Callout**:
    - If deletion fails (e.g. obligations have payment allocations), `ContributionsPage.vue` keeps the dialog open and displays the actual error in a `.dialog-error-callout` inside the modal as well as a toast.
  - **Two-Phase Resilient Deletion**:
    - In `financeService.deleteContributionCollection(col)`:
      - Validates that zero payment allocations exist across all obligations in this collection. If any payments exist, immediately throws an error: `Cannot delete contribution collection because payments have already been collected for it. Archive or deactivate instead.`
      - Deletes unpaid child `student_obligations` explicitly before deleting the parent `obligation_rules` record. This guarantees complete cleanup regardless of whether `ON DELETE CASCADE` or `ON DELETE SET NULL` is currently active on the remote database.
      - Never passes synthetic legacy identifiers to UUID database columns.
      - Uses a single database transaction in SQLite offline-first mode.

### 18.6. Student Profile Photo Upload & Client-Side Image Optimization
- **Client-Side Compression (`src/utilities/image-compression.ts`)**:
  - Implemented automatic image optimization before upload:
    - Downscales images to a maximum of 640 × 640 pixels while preserving aspect ratio.
    - Encodes to WebP at 75–80% quality with automatic fallback to optimized JPEG (80%) when WebP is unsupported.
    - Strips all EXIF, orientation, and location metadata via clean canvas re-drawing.
    - Targets compressed payloads under 150 KB with multi-pass quality tuning when necessary.
    - Validates file type and ensures raw files > 15MB are safely rejected before processing.
- **Upload UI & Confirmation Preview (`src/views/StudentProfilePage.vue`)**:
  - Displays a preview modal (`UniSheet`) before upload showing the optimized image, original file size, compressed size with percentage savings badge, dimensions, and format.
  - Replaced native `window.confirm` with a destructive confirmation dialog (`UniDialog`) for photo deletion.
  - Shows clear loading states (`Optimizing...`, `Uploading...`, and disabled buttons) to prevent race conditions.
- **Supabase Storage Integration (`src/services/student.service.ts`)**:
  - Reuses the existing `student-profile-photos` private bucket without creating duplicate buckets.
  - Enforces consistent student UUID file paths: `${studentId}/profile.webp` (or `profile.jpg`).
  - Uses `upsert: true` to overwrite existing photos cleanly.
  - Deletes previous storage paths only after the replacement upload and database update succeed.
  - Generates secure 1-hour signed URLs with expiry-aware in-memory caching (`photoUrlCache`).
  - Preserves offline-first local base64 storage in SQLite (`photo_local_uri`).
- **Omnipresent UI Display with Initials Fallback**:
  - Integrated student photo display across all student views:
    - `StudentProfilePage.vue`: Hero card avatar with upload, preview, and delete controls.
    - `StudentCard.vue`: Student directory row avatar with `@error` fallback to student initials.
    - `StudentHomeView.vue`: Student portal hero card avatar with graceful initials fallback.
    - `StudentPassPage.vue`: CSG Student Pass avatar with photo and initials fallback.
    - `AttendanceScanPage.vue`: Displays the student's photo during visual identity verification and in the confirmed attendance result card.

### 18.7. Minimal Events Detail UI & Action Permissions (`src/views/EventDetailPage.vue`)
- **Action Access Matrix**:
  - **DEVADMIN**:
    - **Edit Event**: ALLOWED (unconditional).
    - **Delete Event**: ALLOWED (exclusive to DEVADMIN; protected against paid absence fines).
    - **Add Session**: ALLOWED.
    - **Edit Session**: ALLOWED (title, date, start/end time, grace period, configured checkpoints).
    - **Delete Session**: ALLOWED (exclusive to DEVADMIN; protected against paid absence fines).
    - **Manage Checkpoints**: ALLOWED.
  - **OFFICER**:
    - **Edit Event**: ALLOWED for authorized officers with active appointments and `FULL` preset or `CUSTOM` permission `events.edit_assigned`, within assigned event/organization scope and semester.
    - **Delete Event**: STRICTLY NOT ALLOWED. Completely hidden from the action menu, dialog modal unmounted (`v-if="isDevAdmin"`), and guarded at the action handler level (`handleDeleteEvent`). Enforced at the database level by Supabase DELETE RLS (`public.get_current_user_role() = 'DEVADMIN'`).
    - **Add Session**: Subject to appointment permissions (`events.create` or `FULL` preset within scope/semester). Button and empty state quick action hidden if unauthorized.
    - **Edit Session**: ALLOWED for authorized officers with `events.edit_assigned` permission or `FULL` preset within scope and semester.
    - **Delete Session**: STRICTLY NOT ALLOWED. Completely hidden from the session action sheet, confirmation dialog unmounted (`v-if="isDevAdmin"`), and guarded at the action handler level (`handleConfirmDeleteSession`).
    - **Manage Checkpoints**: Subject to appointment permissions (`events.edit_assigned` or `FULL` preset within scope/semester). Checkpoints button on occurrences hidden if unauthorized.
- **Attendance Session Management UI & Workflow**:
  - **Compact Session Action Menu (`UniSheet`)**:
    - Each attendance session card displays a three-dot button in its trailing header (`.occ-top-trailing`), visible to DEVADMIN and authorized officers with `events.edit_assigned`.
    - Triggers a bottom sheet with options:
      - **Edit Session**: Opens full session configuration sheet.
      - **Delete Session**: Visible to DEVADMIN only (red destructive option).
  - **Edit Session Sheet (`UniSheet`, expanded)**:
    - Allows editing session title, session date, start time, end time, grace period, and attendance checkpoints (IN/OUT labels and order).
    - Validates required inputs before submission.
    - Calls `eventService.updateOccurrence(dto)` updating fields in Direct Supabase or SQLite offline mode.
    - Preserves existing attendance records and occurrence UUID.
    - Refreshes session details immediately upon success.
  - **Centered Delete Session Confirmation Modal (`UniDialog`)**:
    - Rendered strictly for DEVADMIN (`v-if="isDevAdmin"`).
    - Displays session title, scheduled date, time window, and current status.
    - Clearly warns that operational attendance scan records and associated unpaid student absence fines will be deleted.
    - Clarifies that if paid absence fines exist, Supabase trigger `trg_protect_event_occurrence_deletion` blocks deletion to safeguard financial audit immutability.
    - Displays loading state (`:loading="isDeletingSession"`) and keeps modal open (`:prevent-auto-close="true"`) to present any Supabase error messages.
    - Refreshes attendance sessions immediately after confirmed deletion.
- **Scope & Semester Restrictions**:
  - Mirrored PostgreSQL security definer helper `public.can_user_manage_event(p_event_id, p_semester_id, p_required_permission)` in `OfficerManagementService.userCanManageEvent()`:
    - Validates active status, start/end dates, and lack of suspension/revocation.
    - Respects `ORGANIZATION` scope (all events) and `EVENT` scope (`scope_id` matching targeted event UUID).
    - Respects appointment semester restrictions when `semester_id` is specified on the appointment.
- **Centered Delete Event Confirmation Dialog (`UniDialog`)**:
  - Displays event title, event category/type, and attendance session count.
  - Clarifies that attendance sessions, scan records, and unpaid absence fines will be deleted.
  - Highlights that Supabase delete protection prevents deletion if paid absence fines exist.
  - Features `:loading="isDeletingEvent"` spinner feedback and `:prevent-auto-close="true"` so that errors remain visible.
  - Displays in-modal Supabase error callout if deletion fails, keeping dialog open for user review.
  - Upon confirmed deletion, displays a success toast and redirects to `/tabs/events`.
- **Verification**:
  - Unit tests in `tests/unit/event-detail-actions.spec.ts` (20/20 tests passed) verify:
    - DEVADMIN edit/delete authority for events and occurrences.
    - Authorized OFFICER edit access under `FULL` and `CUSTOM` presets.
    - Strict OFFICER exclusion from event and session deletion across UI and action handlers.
    - STUDENT exclusion from all management actions.
    - Scope boundary enforcement (`ORGANIZATION` vs `EVENT`).
    - Semester boundary enforcement.
    - Unauthorized or expired officer appointment denial.
    - Session deletion confirmation safety specifications.
    - Session update validation rules.
  - Unit tests in `tests/unit/event.service.spec.ts` (5/5 tests passed) verify `updateOccurrence` and `deleteOccurrence` operations in `EventService`.

### 18.8 Direct PDF Downloading in Financial Reports (`/finance/reports`)

- **Zero-Dependency PDF 1.4 Generator**:
  - Implemented `ReportService.generateObligationsPdf(reportRows, semesterLabel, generatedBy): Uint8Array` adhering to PDF 1.4 specification without external heavy libraries.
  - Generates top brand accent line (`#0F766E`), title, subtitle, metadata (Term, Generated By, Date), 3 financial summary KPI cards (Total Assessed, Total Collected, Total Outstanding), and full obligation table with column headers and zebra striping.
  - Sanitizes non-ASCII/Unicode glyphs (including currency symbol `₱` into `PHP `) for standard PDF WinAnsiEncoding compatibility across all desktop, Android WebView, and mobile PDF readers.
  - Supports automatic multi-page pagination (26 rows on page 1, 34 rows on subsequent pages) with page numbering footer (`Page X of Y`).
- **Direct File Download Trigger**:
  - Replaced browser preview/`window.open()` popups with the standard browser download mechanism using `Blob` (`type: 'application/pdf'`) and an anchor tag (`<a>`) with the `download` attribute and Object URL cleanup.
  - Formatted descriptive filenames via `ReportService.buildObligationsPdfFilename(currentSem)` matching `UniTap_Financial_Report_2026-2027_1st_Semester.pdf`.
  - Added dedicated Download PDF action (`:icon="documentTextOutline"`) in `ReportsPage.vue` header with loading indicator (`isDownloadingPdf`) and duplicate download prevention.
  - Kept the separate Print button (`openPrintPreview()`) working normally for standard printing.
- **Verification**:
  - Unit tests in `tests/unit/filters-and-reports-ui.spec.ts` verify filename formatting, PDF 1.4 byte stream structure (`%PDF-1.4`, `%%EOF`), multi-page distribution, and empty state handling (8/8 tests passed).
  - Both `vue-tsc --noEmit` and production build (`npm run build`) passed with zero errors.

### 18.9 Student Self-Service Profile Photo Upload & Storage Permissions

- **Student Portal Polished Integrated Avatar & Upload UI (`src/components/student/StudentHomeView.vue`)**:
  - Integrated photo editing directly into the student avatar (`.student-hero-avatar-btn`) without creating an extra button row:
    - Entire 56×56px avatar functions as an accessible, clickable button (`:title` / `:aria-label="hasProfilePhoto ? 'Change profile photo' : 'Add profile photo'"`).
    - Features a small circular camera badge overlay (`.avatar-photo-edit-badge`) in the bottom-right corner with UniTap teal styling and subtle hover/active states.
    - When no photo exists, initials are displayed with the camera badge, inviting students to upload.
    - When photo exists, the photo displays cleanly with the camera badge overlay.
    - Stops event propagation (`@click.stop`) to prevent bubbling to the Student Pass navigation.
    - Perfectly aligns student name, School ID, program, year level, and section beside the avatar without vertical crowding or unbalanced extra rows.
  - Automatically processes selected images through client-side compression (`compressStudentPhoto`), validating dimensions (max 640×640 px), format (WebP with JPEG fallback), and stripping metadata.
  - Displays a preview sheet (`UniSheet`) detailing original file size, compressed size, compression savings percentage, and image preview before confirming upload.
  - Re-fetches portal data and immediately updates the reactive `student.photoUrl` and `student.photoStoragePath` across both Student Portal and Digital Pass views without requiring logout.
- **Forward-Only Database Migration (`supabase/migrations/20261108180000_student_self_service_photo_permissions.sql`)**:
  - **Storage Policies on `student-profile-photos`**:
    - Tightened Authenticated Student `INSERT`, `UPDATE`, and `DELETE` policies to permit strictly authorized profile filenames matching their own UUID:
      `name IN (<student_uuid>/profile.webp, <student_uuid>/profile.jpg, <student_uuid>/profile.jpeg, <student_uuid>/profile.png)`
    - Both `USING` and `WITH CHECK` clauses are enforced on `UPDATE` to prevent path tampering or arbitrary file storage.
    - Preserves existing DEVADMIN and active OFFICER management policies and keeps bucket private.
  - **Secure SECURITY DEFINER RPC (`public.update_student_profile_photo_path`)**:
    - Allows authenticated students to update only their own `students.photo_storage_path` column, preventing broad table-level UPDATE grants.
    - Resolves student UUID strictly via `public.get_current_user_student_id()`.
    - Enforces path validation (`<student_uuid>/profile.(webp|jpg|jpeg|png)`) or `NULL` for photo removal, preventing cross-student manipulation or arbitrary column alterations.
    - Configured with `SET search_path = ''` to prevent search_path hijacking.
- **Service Integration (`src/services/student.service.ts`)**:
  - For `isSelfService = true`, `uploadStudentPhoto` calls `update_student_profile_photo_path` RPC directly without relying on catching PostgreSQL `42501` (preventing silent 0-row RLS updates).
  - For `isSelfService = false`, preserves direct table UPDATE for DEVADMIN and active OFFICERs.
  - Guarantees Storage upload succeeds before updating the database path.
  - Cleans up any previous photo only after both Storage upload and database update succeed.
  - In `deleteStudentPhoto`, clears the database path to `NULL` before deleting the object from Storage.
- **Verification**:
  - Unit tests in `tests/unit/student-photo-compression-and-storage.spec.ts` (16/16 passing) verify direct RPC invocation, DEVADMIN/OFFICER direct table update preservation, cross-student update rejection, unapproved filename rejection, correct call order, and photo removal.
  - Regression test suites passed (39 tests total), `vue-tsc --noEmit` passed with 0 errors, and `npm run build` compiled cleanly.

#### Complete Migration SQL for Manual Execution

```sql
-- ==============================================================================
-- UniTap 2.0: Student Self-Service Photo Permissions & Secure Storage RPC
-- Migration: 20261108180000_student_self_service_photo_permissions.sql
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

REVOKE ALL ON FUNCTION public.update_student_profile_photo_path(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.update_student_profile_photo_path(text) TO authenticated;

COMMIT;
```

---

### 18.10. Attendance Checkpoints Individual Scan Time Windows & Server-Authoritative Verification

#### Feature Overview
To prevent premature or late attendance scans across multi-session events (such as morning assemblies followed by afternoon breakout sessions), each attendance checkpoint now supports dedicated `opensAt` and `closesAt` scan time windows.

1. **Checkpoint Configuration UI (`EventDetailPage.vue`)**:
   - The "Configure Checkpoints" and "Edit Session" sheets provide dedicated `Opens At` and `Closes At` inputs for every checkpoint.
   - Validation ensures:
     - Checkpoint closing time is strictly later than opening time.
     - Checkpoint scanning window fits within the parent attendance session hours (`starts_at` to `ends_at`).
     - Validation warnings and errors are clearly presented prior to saving.
   - Occurrence cards and checkpoint lists display scan time windows (e.g. `8:00 AM – 8:30 AM`).

2. **Client & Offline First Enforcement (`attendance.service.ts`)**:
   - `prepareNfcVerification` and `confirmStudentAttendance` enforce scan windows when configured on the active checkpoint.
   - Attempts before the window opens return or throw `CHECKPOINT_NOT_OPEN` (`"Checkpoint is not open for scanning yet. Scanning window opens at..."`).
   - Attempts after the window closes return or throw `CHECKPOINT_CLOSED` (`"Checkpoint scanning window has closed. Window closed at..."`).

3. **Server-Authoritative Enforcement (`20261108190000_checkpoint_scan_time_windows.sql`)**:
   - Upgrades `record_attendance_scan` RPC.
   - Resolves active checkpoint from `event_occurrences.checkpoints_json`.
   - When `opensAt` and `closesAt` are configured on the active checkpoint, computes window bounds against `(occurs_on || ' ' || opensAt)::timestamp AT TIME ZONE 'Asia/Manila'`.
   - Compares against authoritative server timestamp `now()`.
   - Logs rejection attempt to `attendance_attempts` and returns status `CHECKPOINT_NOT_OPEN` or `CHECKPOINT_CLOSED`.
   - Preserves appointment authorization, event scope, idempotent scanning, and duplicate-scan protection.

---

### 18.11. Resolution of Android NFC Scanner Foreign Key Error 787 & Independent Scanning Windows

#### 1. Root Cause Analysis: SQLite Foreign Key Error 787
During Android NFC attendance scanning, `@capacitor-community/sqlite` threw native unhandled exception `Run: FOREIGN KEY constraint failed (code 787)`:
1. **Mandatory Audit Actor Foreign Key (`attendance_audit.actor_user_id`)**:
   - The SQLite `attendance_audit` table specifies `actor_user_id TEXT NOT NULL REFERENCES users(id)`.
   - When officers logged in via Supabase Auth without a pre-existing row in local SQLite `users` table (or when `officerId` defaulted to `'officer_user'`), `AttendanceRepository.recordAttendance` attempted an audit log insertion referencing a non-existent `users(id)`, triggering native constraint violation 787.
2. **Missing Local Parent Records in Offline Scanning (`attendance_records`)**:
   - `attendance_records` enforces strict foreign keys: `occurrence_id REFERENCES event_occurrences(id)` and `student_id REFERENCES students(id)`.
   - In offline-first mode, attempting to record attendance for an occurrence or student not yet downloaded or cached locally triggered raw code 787 failures.
3. **Attempt Logging Foreign Key Failures (`attendance_attempts`)**:
   - `attendance_attempts` requires `occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id)`.
   - When scanning an invalid NFC tag or an occurrence not present in SQLite, `AttendanceRepository.logAttempt` attempted an INSERT that immediately failed foreign key validation.
4. **Direct Supabase Mode Leakage**:
   - `attendanceService.rejectStudentScan` called `AttendanceRepository.logAttempt` unconditionally on SQLite rather than inserting into remote Supabase `attendance_attempts`.

#### 2. Implemented Fixes
1. **Direct Supabase Mode Protection (`attendance.service.ts`)**:
   - `rejectStudentScan` now branches on `DataModeService.isDirectSupabase()`, writing directly to Supabase `attendance_attempts` and bypassing local SQLite completely.
   - `confirmStudentAttendanceDirect` ensures normalized RFID UIDs are passed to the remote `record_attendance_scan` RPC.
2. **Local SQLite Referential Pre-Checks (`attendance.repository.ts`)**:
   - `recordAttendance` pre-validates occurrence existence against `event_occurrences` (matching canonical UUIDs and `occ_` prefixes) and student existence against `students`.
   - `recordAttendance` resolves `actor_user_id` against active provisioned users in SQLite `users` to guarantee referential validity.
   - If referenced parent records are missing, it throws clear, descriptive errors (e.g. `"[AttendanceRepository] Cannot record attendance offline: Event occurrence ... not found in local database. Please sync events first."`) instead of crashing the native SQLite engine.
3. **Resilient Attempt Logging (`attendance.repository.ts`)**:
   - `logAttempt` pre-verifies `occurrence_id` in SQLite; if absent, it logs a diagnostic warning rather than attempting an invalid INSERT.
   - Optional foreign keys (`student_id`, `card_id`, `actor_user_id`) are verified; if unresolvable, they are safely nullified.
   - `devices` default record (`dev_default`) is idempotently ensured.
4. **User-Friendly Error Mapping (`AttendanceScanPage.vue`)**:
   - Intercepts raw code 787 and foreign key errors, presenting actionable guidance:
     - `"Attendance session is not available in local database. Please sync events online before offline scanning."`
     - `"Student record is not available in local database. Please sync student directory online."`
     - `"Officer credentials missing locally. Please log in online to initialize offline scanning access."`
   - Logs non-sensitive diagnostic telemetry (`error`, `formatted`, `occurrenceId`, `tagId`).
5. **Independent Checkpoint Scanning Windows (`EventDetailPage.vue`)**:
   - Removed restrictions binding checkpoint windows inside official event hours (`starts_at` to `ends_at`).
   - Checkpoints now fully allow early IN (e.g., 7:00 AM for an 8:00 AM event) and late OUT (e.g., 5:30 PM for a 5:00 PM event), validated against server-authoritative Asia/Manila time in Direct Supabase mode while preserving start/end ordering (`closeMin > openMin`).
6. **Quick Checkpoint Templates & Duplicate Prevention (`EventDetailPage.vue`)**:
   - Added 4 client-side presets to "Configure Checkpoints" and "Edit Session" sheets:
     - Morning IN (IN, 7:00 AM – 8:30 AM)
     - Morning OUT (OUT, 11:30 AM – 12:30 PM)
     - Afternoon IN (IN, 12:30 PM – 1:30 PM)
     - Afternoon OUT (OUT, 4:30 PM – 5:30 PM)
   - One-tap autofill for label, type, opening time, and closing time.
   - Allows full manual editing before adding.
   - Preserves manual workflow, existing saved checkpoints, and unique checkpoint IDs.
   - Prevents duplicate checkpoints by label (case-insensitive deduplication check with toast notification).

---

## 19. Supabase Migration Deployment History & Status

| Migration File | Description | Deployment Method | Deployed Date | Status |
|---|---|---|---|---|
| `20261108190000_checkpoint_scan_time_windows.sql` | Server-Side Attendance Checkpoint Scanning Window Enforcement (`record_attendance_scan`) | Supabase Dashboard SQL Editor | Pending Manual Execution | **STAGED / READY** |
| `20261108180000_student_self_service_photo_permissions.sql` | Student Self-Service Photo Storage RLS & Secure Path Update RPC (`update_student_profile_photo_path`) | Supabase Dashboard SQL Editor | Pending Manual Execution | **STAGED / READY** |
| `20261108160000_devadmin_cascades_and_delete_protection.sql` | DEVADMIN FK Cascades, Orphan Precondition, RLS Helper & Deletion Protection | Supabase Dashboard SQL Editor | November 8, 2026 | **DEPLOYED** (User-confirmed) |
| `20261108170000_attendance_checkpoints_and_storage.sql` | Configurable Attendance Checkpoints IN/OUT, Unique Checkpoint Constraint & Private Profile Photo Storage Bucket | Supabase Dashboard SQL Editor | November 8, 2026 | **DEPLOYED** (User-confirmed) |
| `20261108150000_fix_student_obligations_rls.sql` | Student Obligations RLS Fix for DEVADMIN & ACTIVE Officers | Supabase Dashboard SQL Editor | November 8, 2026 | **DEPLOYED** (User-confirmed) |
| `20261108140000_student_to_officer_promotion.sql` | Student-to-Officer Promotion RPC (`devadmin_promote_student_to_officer`) | Supabase Dashboard SQL Editor | November 8, 2026 | **DEPLOYED** (User-confirmed) |
| `20261108130000_scoped_events_rls.sql` | Event Scoping & Officer Permission RLS Remediation | Supabase Dashboard SQL Editor | November 8, 2026 | **DEPLOYED** (User-confirmed) |
| `20261108120000_harden_officer_activation_status.sql` | RPC Activation Status Lookup & Officer Appointment Hardening | Supabase Dashboard SQL Editor | November 8, 2026 | **DEPLOYED** (User-confirmed) |

---

## 20. Live Runtime Verification Checklist

The following items should be exercised during live user acceptance testing:

- [ ] **DEVADMIN-Only Deletion & Financial History Protection**:
  - Verify that DEVADMIN users can delete parent records (such as unassigned programs or unused obligation rules) with automatic cascade.
  - Verify that non-DEVADMIN users (such as standard officers or students) attempting destructive deletions are rejected with `42501` (permission denied).
  - Verify that deleting any obligation or parent rule with existing `payment_allocations` is strictly blocked by database triggers to maintain audit immutability.

- [ ] **Automatic Contribution Child-Record Deletion**:
  - Create a test contribution collection without payments and click the delete button on the card or in the Details sheet.
  - Verify that confirming deletion deletes both the parent rule and all assigned unpaid `student_obligations` cleanly without leaving orphaned records.

- [ ] **Attendance IN/OUT Checkpoint Validation**:
  - Configure multi-checkpoint attendance on an event occurrence (e.g. "Morning IN" and "Morning OUT").
  - Verify that tapping a student NFC card identifies the active checkpoint and logs the correct audit entry (`CHECK_IN` or `CHECK_OUT`).
  - Verify that a second tap against the same active checkpoint reports duplicate scan and prevents double-marking.
  - Verify switching to the second checkpoint allows the student to scan once for that specific checkpoint.

- [ ] **Attendance Checkpoint Individual Scan Time Windows**:
  - Configure an attendance session with individual checkpoint windows (e.g. Morning IN: 8:00 AM – 8:30 AM, Morning OUT: 11:30 AM – 12:00 PM).
  - Verify scans attempted prior to 8:00 AM are rejected with `CHECKPOINT_NOT_OPEN`.
  - Verify scans between 8:00 AM and 8:30 AM succeed and mark status appropriately (`PRESENT` or `LATE` if past grace minutes).
  - Verify scans after 8:30 AM are rejected with `CHECKPOINT_CLOSED`.
  - Verify switching the active checkpoint to Morning OUT enforces its 11:30 AM – 12:00 PM window independently.

- [ ] **Private Student Photo Storage Upload & Signed URL Retrieval**:
  - Upload a profile photo from the Student Profile page; verify that client-side image compression converts it to optimized WebP/JPEG under 150 KB.
  - Verify that the photo uploads to the private `student-profile-photos` bucket using the student's UUID as the storage path.
  - Verify that signed URLs load smoothly across Student Directory cards, Student Pass, Student Portal, and NFC attendance tap verification results.

---

## 21. Android & Web Data Consistency, Sync Diagnostics & Build Identity

**Date:** November 10, 2026  
**Status:** Completed & Verified  
**Scope:** Android/Web Data Consistency, Direct Mode Persistence, Offline-First Background Hydration, Accurate Sync Diagnostics, and Android APK Build Identity

### 21.1. Confirmed Root Causes

1. **Runtime Data Mode Divergence & Lack of Cross-Platform Persistence**:
   - Web was executing in Direct Supabase Mode (`VITE_DATA_MODE=supabase_direct` in `.env.local`), querying Supabase PostgREST directly (displaying 300 students, 2 active events, ₱150,000 outstanding).
   - The installed Android APK executed in Offline-First mode because runtime data mode selection was not persisted across mobile application restarts, defaulting back to SQLite where the `events` table contained 0 records.
2. **Missing Offline Event Hydration**:
   - While `HomePage.vue` refreshed students, charges, and obligations on mount, it never invoked `SelectiveSyncService.refreshEvents()`. `EventsPage.vue` also lacked an automated pull trigger, leaving the local SQLite `events` and `event_occurrences` tables empty unless an explicit manual sync was triggered in Settings.
3. **Foreign Key (Code 787) Failures in SchemaMapper**:
   - Remote Supabase events reference `semester_id`, `category_id`, and `created_by_user_id`. When pulling remote events into an unpopulated or partially populated SQLite database, missing parent foreign keys caused native SQLite execution failure `Run: FOREIGN KEY constraint failed (code 787)`, rejecting the event inserts.
4. **5 "Pending Pulls" Calculation False Positive**:
   - `SyncManager.refreshCountsFromDatabase()` queried:
     ```sql
     SELECT COUNT(*) as pending_pulls FROM sync_state WHERE last_sync_status != 'SUCCESS' OR records_pulled = 0
     ```
   - Five remote Supabase tables (`event_categories`, `event_participants`, `attendance_records`, `attendance_audit`, and `payment_allocations`) currently contain 0 records. Even though pull sync completed with status `'SUCCESS'`, their `records_pulled` remained 0, causing the query to misidentify all 5 tables as "pending pulls".
5. **Misleading "Up to Date" Indicator in Sync Status**:
   - `SyncStatusService.userFacingStatus` returned `'Up to Date'` whenever `isSyncing` was false and no push mutations were queued, completely ignoring `pendingPullCount > 0`.
6. **Premature Loop Break in PullSyncService**:
   - `pullRemoteChanges` contained a loop break on any individual entity failure, causing subsequent entity tables to be skipped rather than attempting best-effort hydration.

### 21.2. Implemented Fixes

1. **`src/services/data-mode.service.ts`**:
   - Updated `resolveInitialMode()` to inspect both `localStorage` and `@capacitor/preferences` with storage key `'unitap_data_mode'`. Defaults to `'supabase_direct'` outside of testing environments.
   - Updated `setMode()` to persist runtime mode asynchronously to `@capacitor/preferences` and synchronously to `localStorage`.
   - Added `getEnvironmentInfo()` returning `mode`, `modeLabel`, `supabaseUrl`, `versionName: '1.0.1'`, and `versionCode: 2`.
2. **`src/services/sync/sync-manager.ts`**:
   - Corrected pending pulls query to check against unattempted baseline timestamp rather than 0 record count:
     ```sql
     SELECT COUNT(*) as pending_pulls FROM sync_state WHERE last_sync_status != 'SUCCESS' OR last_pulled_at = '1970-01-01T00:00:00.000Z'
     ```
   - Entities with 0 remote records that sync successfully with status `'SUCCESS'` are no longer counted as pending pulls.
3. **`src/services/sync/sync-status.service.ts`**:
   - Added `'Sync Incomplete'` to `UserFacingSyncStatus`.
   - Updated `userFacingStatus` getter: when `pendingPullCount > 0` and not actively syncing, reports `'Sync Incomplete'` instead of `'Up to Date'`.
4. **`src/services/sync/schema-mapper.service.ts`**:
   - In `mapRecord` for `event_occurrences`, added mapping for `checkpoints_json` from `raw.checkpoints` / `raw.checkpoints_json`.
   - In `safeUpsertRecord` for `events`:
     - Checks if referenced `semester_id` exists in SQLite; if missing, automatically provisions minimal parent `academic_years` and `semesters` records.
     - Safely nullifies `category_id` and `created_by_user_id` if missing in local tables, preventing SQLite code 787 foreign key crashes.
   - In `safeUpsertRecord` for `event_occurrences`:
     - Sanitizes `starts_at` and `ends_at` to prevent SQLite CHECK constraint failures if remote timestamps are improperly ordered.
5. **`src/services/sync/pull-sync.service.ts`**:
   - In `pullRemoteChanges`, removed premature loop break. The loop only terminates if the client is completely offline or `sync_pull_entity_v2` RPC does not exist, enabling resilient best-effort pulls.
6. **`src/views/HomePage.vue` & `src/views/EventsPage.vue`**:
   - In Offline-First mode (`!isDirectSupabase`), triggers background `SelectiveSyncService.refreshEvents()` when online and refreshes reactive event counters and lists upon completion.
7. **`src/views/SettingsPage.vue`**:
   - Made Section 4 ("Data Mode, Sync Center & Diagnostics") visible in both Direct Supabase and Offline-First modes.
   - Added Runtime Data Mode selector and Environment Diagnostics card (`envInfo`), displaying active mode, Supabase project URL, package identity, and build version.
   - Enabled runtime toggling via `handleToggleDataMode()`.
   - Fixed tag structure and mapped `'Sync Incomplete'` to amber status dot.
8. **`android/app/build.gradle`**:
   - Incremented `versionCode` to `2` and `versionName` to `"1.0.1"` for unambiguous build identity.

### 21.3. Verification Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| Targeted Unit Tests | `npx vitest run tests/unit/data-consistency-mode.spec.ts tests/unit/checkpoint-time-windows.spec.ts` | **32 of 32 PASSED** (Exit code 0) |
| Related Sync Unit Tests | `npx vitest run tests/unit/selective-sync.spec.ts tests/unit/sync-preferences.spec.ts` | **29 of 29 PASSED** (Exit code 0) |
| TypeScript Typecheck | `npx vue-tsc --noEmit` | **0 errors** (Exit code 0) |
| Production Build | `npm run build` | **SUCCESSFUL** in 1m 46s (Exit code 0) |
| Capacitor Android Sync | `npx cap sync android` | **SUCCESSFUL** in 3.27s (Exit code 0) |
| Android Debug APK | `Set-Location android; .\gradlew.bat assembleDebug` | **BUILD SUCCESSFUL** in 1m 32s (Exit code 0) |
| APK Artifact Inspection | `android/app/build/outputs/apk/debug/app-debug.apk` | **18,019,557 bytes**, LastWriteTime: `11/10/2026 2:20:50 AM` |

---

## 22. Unified NFC Recognition & Student Photo Identity Verification

**Date:** November 10, 2026  
**Status:** Completed & Verified  
**Scope:** Attendance Scanner NFC Identification, Cross-Module UID Normalization, Private Storage Student Photo Resolution, and Multi-Module Visual Identity Verification

### 22.1. Confirmed Root Causes

1. **Inconsistent UID Normalization & Lookup Logic**:
   - `AttendanceScanPage.vue` and `attendance.service.ts` previously stripped all punctuation and colons from scanned card tags (`rawRfidUid.replace(/[^0-9A-F]/g, '')`), creating compact hex strings (e.g. `04A73291`). It then queried Supabase and SQLite with strict equality: `.eq('uid_normalized', cleanUid)`.
   - Cards registered with colon-separated hexadecimal notation (e.g. `04:A7:32:91`) never matched the stripped compact UID, causing Attendance Scanner to report valid cards as "UNREGISTERED".
   - In contrast, `NfcCheckerPage.vue` and `MakePaymentPage.vue` utilized `studentService.lookupCard()`, which tests both formatted and compact representations across active and inactive cards.
2. **Conflation of Query Errors with "UNREGISTERED" Status**:
   - In `attendance.service.ts`, if Supabase returned a PostgREST error (e.g. network timeout, RLS denial, or missing session token), the query result data was null. The code treated this as "Card not found" and reported "UNREGISTERED" rather than surfacing the actual exception.
3. **Missing Profile Picture Display During Attendance & Payment Scans**:
   - Although UniTap 2.0 requires officers to visually verify student identity prior to confirming attendance, `AttendanceScanPage.vue` lacked robust signed URL retrieval for private bucket `student-profile-photos`.
   - `NfcCheckerPage.vue` and `MakePaymentPage.vue` only displayed default placeholder icons or text initials without rendering the student's uploaded profile picture.
   - When student profile pictures failed to load or signed URLs expired, there was no graceful fallback to computed initials or dynamic URL refresh.

### 22.2. Architectural Remediation

1. **Unified NFC Card Lookup Service**:
   - `attendance.service.ts` (`prepareNfcVerificationDirect` and `prepareNfcVerification`) now exclusively reuses `studentService.lookupCard(rawRfidUid)`.
   - Authoritative lookup errors (network failure, RLS rejection) throw directly rather than being swallowed into false "UNREGISTERED" results.
   - Genuinely unregistered cards are distinguished from `INVALID` cards (`LOST`, `REPLACED`, `DEACTIVATED`).
2. **Bi-Directional UID Format Matching (`CardsRepository.lookupCardRecord`)**:
   - `CardsRepository.lookupCardRecord` and `CardsRepository.getCardByNormalizedUid` now generate multiple search variants (clean raw, compact hex, and colon-separated pairs).
   - In Direct Supabase mode: utilizes `.in('uid_normalized', variants)` with a safe fallback to active card inspection.
   - In SQLite mode: executes `SELECT * FROM nfc_cards WHERE (uid_normalized = ? OR replace(replace(uid_normalized, ':', ''), ' ', '') = ?) ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END LIMIT 1`.
3. **Private Storage Photo Resolution with Expiry-Aware Caching**:
   - `studentService.resolveStudentPhotoUrl(student, forceRefresh = false)` generates signed URLs via `supabase.storage.from('student-profile-photos').createSignedUrl(storagePath, 3600)`.
   - Supports online resolution in both Direct Supabase and hybrid Offline-First modes.
   - Includes cache bypass when `forceRefresh = true` to recover from expired URLs on image load error (`@error`).
4. **Enhanced Visual Identity Card in `AttendanceScanPage.vue`**:
   - Displays prominent student profile picture (80x88px with object-fit cover and rounded border).
   - Dynamic error recovery: on image error, requests fresh signed URL or falls back to standard initials avatar generated by `getStudentInitials(fullName)`.
   - Comprehensive student details: Full Name, School ID (`schoolId || student.school_id || student.studentNumber`), Program badge (`BSIT`), Year Level, Section, and Card UID with "Active" badge.
5. **Student Photo Integration in `NfcCheckerPage.vue` and `MakePaymentPage.vue`**:
   - `NfcCheckerPage.vue`: Registered and inactive student cards display the student's photo (52x52px rounded avatar) with initials fallback and `@error` retry handling.
   - `MakePaymentPage.vue`: Selected student banner displays the verified profile photo in `student-avatar-circle` across both NFC tap and manual search identification paths.
6. **Student Initials Helper (`src/utilities/student-formatters.ts`)**:
   - `getStudentInitials(firstNameOrFullName, lastName)`: Extracts clean 1- or 2-letter uppercase initials with fallback to `'ST'`.

### 22.3. Verification Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| Targeted NFC Verification Tests | `npx vitest run tests/unit/attendance-nfc-photo-verification.spec.ts` | **5 of 5 PASSED** (Exit code 0) |
| Full NFC Verification Suite | `npx vitest run tests/unit/nfc-verification.spec.ts tests/unit/attendance-nfc-photo-verification.spec.ts` | **11 of 11 PASSED** (Exit code 0) |
| TypeScript Compiler Check | `npx vue-tsc --noEmit` | **0 errors** (Exit code 0) |
| Production Build | `npm run build` | **SUCCESSFUL** in 28.67s (Exit code 0) |

## 23. Record Payment Eligible-Student Query Fix & Live Supabase Schema Alignment (2026-11-10)

### 23.1. Confirmed Root Causes

1. **Schema Mismatch on `obligation_adjustments` (`adjustment_type` vs `kind`)**:
   - In Direct Supabase mode, `FinanceRepository.getStudentIdsWithOutstandingBalance` selected `obligation_id, kind, amount_centavos` from `obligation_adjustments`.
   - In live Supabase PostgreSQL (defined in `supabase/migrations/20261031000001_unitap_initial_schema.sql`), the column name is `adjustment_type VARCHAR(20) NOT NULL` (e.g. `'WAIVE'`, `'DISCOUNT'`), and there is no column named `kind`.
   - PostgREST rejected the query with `column obligation_adjustments.kind does not exist` (PGRST204).
2. **Silent Failure & Inaccurate "No Outstanding Balances" Empty State**:
   - `MakePaymentPage.vue`'s `loadEligibleStudents()` caught all exceptions and set `eligibleStudents.value = []`.
   - Because `filteredStudents.length === 0` and there was no error state handling, the page erroneously displayed `UniEmptyState` with title "No Outstanding Balances", misleading officers into thinking all students had settled when in fact the query crashed.

### 23.2. Architectural Remediation

1. **Live Supabase Schema Alignment (`FinanceRepository.getStudentIdsWithOutstandingBalance`)**:
   - Updated the batched lookup on `obligation_adjustments` to select `obligation_id, adjustment_type, amount_centavos`.
   - Implemented adjustment type calculation semantics supporting both additions and deductions:
     - Deductions: `'DISCOUNT'`, `'WAIVE'`, `'WAIVER'`, `'REDUCTION'`, `'DEDUCTION'` decrease the obligation balance (`-amt`).
     - Additions: `'ADDITION'`, `'CHARGE'`, `'PENALTY'`, `'ADDITIONAL_CHARGE'` increase the obligation balance (`+amt`).
     - Respects the non-negative constraint `amount_centavos >= 0` via `Math.abs(Number(adj.amount_centavos || 0))`.
     - Supports both `adj.adjustment_type` (Supabase) and `(adj as any).kind` (SQLite) for cross-layer compatibility.
2. **Correct Outstanding Balance Filtering**:
   - Computes `netAssessed = assessed + adjustments` and `remainingBalance = netAssessed - postedPayments`.
   - Excludes `VOID`, `PAID`, and `WAIVED` obligations.
   - Includes students in the eligible payment list if and only if their computed `remainingBalance > 0`.
   - Preserves filtering by category (`ALL`, `CONTRIBUTION`, `FINE`), specific `ruleId`, and active `semesterId`.
3. **Transparent Query Error Propagation & Retry UI (`MakePaymentPage.vue`)**:
   - Replaced silent error swallowing with an explicit `eligibleError` reactive state.
   - When query errors occur, `MakePaymentPage.vue` surfaces a styled error card displaying "Unable to Load Balances", the specific error reason, and an interactive "Retry" button.
   - `UniEmptyState` ("No Outstanding Balances" / "No matching students") is displayed only after a successful query execution returns zero owing students.

### 23.3. Verification Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| Targeted Eligible Students Query Specification | `npx vitest run tests/unit/eligible-students-query.spec.ts` | **8 of 8 PASSED** (Exit code 0) |
| Related Diagnostics & Continuous Finance Recording | `npx vitest run tests/unit/supabase-direct-diagnostic.spec.ts tests/unit/continuous-finance-recording.spec.ts` | **44 of 44 PASSED** (Exit code 0) |
| TypeScript Compiler Check | `npx vue-tsc --noEmit` | **0 errors** (Exit code 0) |
| Production Build | `npm run build` | **SUCCESSFUL** in 33.38s (Exit code 0) |

## 24. Official Payment Receipt PDF Direct Download Architecture (2026-11-10)

### 24.1. Problem & Context

1. **Popup & Print Preview Limitations**:
   - The previous receipt action in `MakePaymentPage.vue` invoked `financeService.generatePrintableReceiptHtml(receipt)` and called `window.open('', '_blank')` followed by `printWindow.print()`.
   - On Android WebViews and mobile browsers, popup blockers frequently intercepted `window.open()`, and `window.print()` is either unsupported or triggers distorted print spoolers rather than saving a clean PDF file.
   - Desktop browsers opened empty `about:blank` tabs or required manual print dialog configuration.

### 24.2. Architectural Remediation

1. **Native Client-Side PDF 1.4 Binary Generator (`ReportService.generateReceiptPdf`)**:
   - Reused UniTap's zero-dependency binary PDF 1.4 generator in `ReportService` to construct fully compliant PDF byte streams (`Uint8Array`) using standard Type 1 fonts (`/Helvetica`, `/Helvetica-Bold`, `/Courier`) and `WinAnsiEncoding`.
   - **Receipt Visual Design & Layout**:
     - UniTap 2.0 brand header (#0F766E teal bar) and CSG subtitle.
     - Dynamic server sync badge: `Authoritatively Confirmed - Server Recorded` or `Locally Recorded - Sync Pending`.
     - 2-column metadata card: Receipt Ref #, Payment Date, Academic Term, Officer Name, Student Name, School ID, Year/Section, and Payment Method (Cash Collection / GCash Transfer / Bank Transfer).
     - Itemized obligations table with individual columns: Obligation Title & ID, Type, Remaining Balance, and Amount Paid.
     - Prominent Total Collected summary box.
     - Payment notes (when present), official CSG electronic receipt notice, and confidentiality footer.
     - Multi-item pagination: gracefully distributes items across multiple pages if a transaction spans more than 8 obligations.
2. **Deterministic Descriptive Filename (`ReportService.buildReceiptPdfFilename`)**:
   - Generates filenames strictly following `UniTap_Receipt_{receipt_reference}.pdf` with character sanitization (`[^a-zA-Z0-9_-]` mapped to `_`).
   - Exposed directly on `FinanceService` (`financeService.generateReceiptPdf` and `financeService.buildReceiptPdfFilename`).
3. **Blob Download Automation & Resource Cleanup (`MakePaymentPage.vue` & `FinancePage.vue`)**:
   - Converted binary byte stream into `application/pdf` Blob: `new Blob([pdfBytes], { type: 'application/pdf' })`.
   - Triggered browser download using a temporary `<a>` element with the `download` attribute (`link.click()`).
   - Completely avoided `window.open`, `window.print`, `target="_blank"`, and `about:blank`.
   - Automatically revokes the object URL via `URL.revokeObjectURL(url)`.
   - Added `isDownloadingReceiptPdf` state with button loading spinner and disabled state to prevent duplicate downloads.
   - Preserved receipt modal state (`isReceiptModalOpen` remains open after download) and the "Next Student (Scan)" workflow button.

### 24.3. Verification Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| Targeted Receipt PDF Specification | `npx vitest run tests/unit/payment-receipt-pdf.spec.ts` | **7 of 7 PASSED** (Exit code 0) |
| Related Payment & Report Suites | `npx vitest run tests/unit/payment-receipt-pdf.spec.ts tests/unit/continuous-finance-recording.spec.ts tests/unit/eligible-students-query.spec.ts tests/unit/filters-and-reports-ui.spec.ts` | **42 of 42 PASSED** (Exit code 0) |
| TypeScript Compiler Check | `npx vue-tsc --noEmit` | **0 errors** (Exit code 0) |
| Production Build | `npm run build` | **SUCCESSFUL** in 16.11s (Exit code 0) |

## 25. Student Account Activation Idempotency & Android Native Runtime Consistency (2026-11-10)

### 25.1. Problem & Root Cause Analysis

1. **Issue 1: `activate_student_account` RPC Duplicate Username (PostgreSQL 23505)**:
   - **Symptom**: Calling `activate_student_account` failed with `23505: duplicate key value violates unique constraint "users_username_key"` for username `mcc2026-0256`. Auth account creation succeeded (`auth/v1/user` returned 200), but activation aborted.
   - **Root Cause**: `public.users` has a unique constraint on `username` (`users_username_key`). The RPC performed `INSERT INTO public.users (id, username, student_id, account_status) VALUES (v_target_user_id, lower(v_student.school_id), ...) ON CONFLICT (id) DO UPDATE`. If another row in `public.users` already held `lower(v_student.school_id)` with a different UUID, `ON CONFLICT (id)` did not match, triggering an unhandled 23505 exception. Additionally, step 2 only checked `WHERE student_id = v_student.id AND account_status = 'ACTIVE'`, missing rows in other statuses.
   - **Remediation**:
     - Authored forward-only migration `supabase/migrations/20261110000000_idempotent_student_activation_repair.sql`.
     - Validates caller ownership: if caller's `public.users` row is already linked to the student, returns idempotent success (`already_linked: true`).
     - Detects conflicts before insertion: if the student or username belongs to another account (`id <> v_target_user_id`), returns an explicit friendly error message.
     - Wraps the `public.users` upsert in an `EXCEPTION WHEN unique_violation` handler to eliminate 500/unhandled crash states.
     - Updated `SupabaseAuthService.registerStudent`: checks for existing active session matching caller email to prevent duplicate Auth account creation on retry; returns `{ success: false, error }` without falling back to local SQLite in Direct Supabase Mode; never calls `handleOnlineSession` or navigates to `/initial-sync` on activation failure.

2. **Issue 2: Android Officer Activation Code SQLite Foreign Key Failure (Code 787)**:
   - **Symptom**: Web activation code issuance succeeded, but on installed Android APK, issuing an activation code failed with `FOREIGN KEY constraint failed`.
   - **Root Cause**: In `StudentActivationService.issueActivationCode`, when online RPC `officer_issue_activation_code` succeeded, the service immediately called `persistLocalClaim` to mirror into SQLite. On native Android (`NativeSqliteAdapter` with `PRAGMA foreign_keys = ON`), `activation_claims.issued_by_user_id` has a foreign key referencing `users(id)`. Because the officer logged in via Supabase Auth and their UUID did not exist in the Android device's local SQLite `users` table, SQLite aborted with error 787. The catch block in `issueActivationCode` trapped this error and returned failure to the officer despite the server RPC having succeeded.
   - **Remediation**:
     - In Direct Supabase Mode (`DataModeService.isDirectSupabase()`), the server RPC is the single authoritative mutation. Eliminated local SQLite mirror writes (`persistLocalClaim` and local audit creation) during code issuance and revocation.
     - Never falls back to local SQLite code generation on RPC failure in Direct Supabase Mode.
     - In Offline-First Mode, `persistLocalClaim` ensures the officer user row exists in SQLite before inserting into `activation_claims`, preventing foreign key failures.

3. **Issue 3: Android Native Runtime Consistency & App Resume**:
   - Verified Supabase URL (`https://snqcbmroefhxkhcadidr.supabase.co`) and public API keys match across Web and Android packages.
   - Prevented asynchronous Capacitor Preferences hydration from overriding the authoritative `VITE_DATA_MODE=supabase_direct` setting on native Android.
   - Added app resume listener via `NetworkService.onAppResume` in `SupabaseAuthService` to refresh live Supabase sessions when resuming the Android application from the background.
   - Added focused diagnostic logging with platform (`Capacitor.getPlatform()`), data mode, RPC results, and error codes without exposing sensitive passwords or tokens.

### 25.2. Migration File Authored

- `supabase/migrations/20261110000000_idempotent_student_activation_repair.sql`

### 25.3. Verification Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| Targeted Activation & Runtime Specification | `npx vitest run tests/unit/student-activation-and-runtime.spec.ts` | **9 of 9 PASSED** (Exit code 0) |
| Related Activation & Role Sync Suites | `npx vitest run tests/unit/role-sync-and-activation.spec.ts tests/unit/student-activation.spec.ts` | **28 of 28 PASSED** (Exit code 0) |
| TypeScript Compiler Check | `npx vue-tsc --noEmit` | **0 errors** (Exit code 0) |
| Production Build | `npm run build` | **SUCCESSFUL** in 52.19s (Exit code 0) |
| Capacitor Android Sync | `npx cap sync android` | **SUCCESSFUL** in 3.29s (Exit code 0) |
| Gradle Debug APK Build | `cd android; .\gradlew.bat assembleDebug` | **BUILD SUCCESSFUL** in 55s (Exit code 0) |
| APK Artifact Verification | `android/app/build/outputs/apk/debug/app-debug.apk` | **17.26 MB** (18,102,582 bytes), verified |

## 26. Officer Management RLS Visibility, Dual-Role Portal Architecture & Initial Sync Routing (2026-11-10)

### 26.1. Problem & Root Cause Analysis

1. **Issue 1: Officer Management RLS Visibility**:
   - **Symptom**: In Officer Management, DEVADMIN could not view all officer appointments. The list only showed appointments matching `user_id = auth.uid()`.
   - **Root Cause**: The RLS SELECT policy on `public.officer_appointments` strictly enforced `user_id = auth.uid() AND status IN ('ACTIVE', 'SUSPENDED')`. There was no policy allowing DEVADMIN to view appointments for all officers.
   - **Remediation**: Authored forward-only migration `supabase/migrations/20261110010000_devadmin_officer_appointments_rls.sql` providing:
     - `DevAdmin view all officer_appointments`: SELECT policy using `public.get_current_user_role() = 'DEVADMIN'`.
     - Preserved ordinary officers' own-appointment SELECT policy (`user_id = auth.uid() AND status IN ('ACTIVE', 'SUSPENDED')`).
     - Restricted INSERT, UPDATE, and DELETE operations on `officer_appointments` exclusively to DEVADMIN.
     - Kept RLS enabled and blocked unauthenticated (`anon`) access.

2. **Issue 2: False Officer Promotion Success Handling & Duplicate Prevention**:
   - **Symptom**: In `CreateOfficerPage.vue`, if `devadmin_promote_student_to_officer` RPC returned `{ success: false, error: '...' }` with an HTTP 200 response, client callers might treat the lack of a transport error as success, displaying the "Officer Promoted" modal despite the server rejecting the operation.
   - **Root Cause**: The client caller did not strictly assert `data.success === true` and did not detect existing active appointments prior to submission.
   - **Remediation**:
     - Updated `OfficerManagementService.promoteStudentToOfficer`: strictly inspects `!data || data.success !== true`, returning `{ success: false, error }` without creating or caching local records.
     - Added `OfficerManagementService.getAppointmentForStudent`: checks live Supabase and SQLite for active/suspended appointments.
     - In `CreateOfficerPage.vue`: checks `getAppointmentForStudent` during student selection, sets `is_officer = 1` and displays the duplicate officer warning banner.
     - In `handleSubmit`: strictly verifies `res && res.success === true` before opening success dialog; otherwise triggers error toast and preserves form state.

3. **Issue 3: Dual-Role Portal Access & Workspace Switching**:
   - **Symptom**: A student promoted to officer possesses dual identities (`STUDENT` and `OFFICER`). Previously, session hydration unconditionally overrode the active role to `OFFICER`, locking them out of the Student Portal dock, digital pass, and student dashboard.
   - **Root Cause**: Session initialization lacked support for multi-role accounts and defaulted to the highest privilege without offering a seamless toggle.
   - **Remediation**:
     - `SupabaseAuthService.handleOnlineSession`: queries all non-revoked remote roles, verifies active appointment validity (`hasValidOfficerAppointment`), and defaults landing portal to `STUDENT` for students with dual roles.
     - Mirrors all active roles into local SQLite without deleting or overriding `STUDENT`.
     - In `authService`: updated `switchWorkspace` to allow switching between `STUDENT` and `OFFICER` without sign-out or credentials loss, synchronizing with `SupabaseAuthService.setActiveRole`.
     - Integrated `WorkspaceSwitcher` into `StudentHomeView.vue` and `SettingsPage.vue`, allowing student-officers to toggle between Student Portal and Officer Workspace instantly.
     - Guarded Officer Portal access with `hasValidOfficerAppointment` (checks `status === 'ACTIVE'`, not revoked, and valid appointment dates).

4. **Issue 4: Initial Sync Routing in Direct Supabase Mode**:
   - **Symptom**: In Direct Supabase Mode, navigating to `/initial-sync` could cause unnecessary delay or become unresponsive if full table hydration into SQLite was attempted.
   - **Root Cause**: `/initial-sync` was designed for SQLite offline hydration, which is bypassed when `DataModeService.isDirectSupabase()` is true.
   - **Remediation**:
     - In `InitialSyncPage.vue`: when `DataModeService.isDirectSupabase()` is true, immediately sets hydration to `READY` and state to `SYNCED`, and navigates directly to `/tabs/home` (or the active portal).

### 26.2. Forward-Only Migration Authored

- `supabase/migrations/20261110010000_devadmin_officer_appointments_rls.sql`

*(Note: Author migration file only; not executed against live database per strict instructions).*

### 26.3. Multi-Role Resolution, Dynamic Portal Switching & Settings Account Polish

1. **Multi-Role Resolution from Remote Database**:
   - Resolved the fundamental limitation of `get_current_user_role()`, which only returns a single role based on priority (`DEVADMIN > OFFICER > STUDENT`), effectively masking other active roles.
   - Updated session hydration (`handleOnlineSession` and `restoreOfflineSession`) to query all active, non-revoked records directly from `public.user_roles WHERE user_id = auth.uid() AND revoked_at IS NULL`.
   - Populated `currentRoles` and exposed `roles` so that all active roles (e.g. `['STUDENT', 'OFFICER']`) are retained in client state.
   - Verified active officer appointment validity via `OfficerManagementService.hasValidOfficerAppointment(userId, studentId)`.

2. **Independent Portal Resolution & State Separation**:
   - Strictly separated `availablePortals` / `availableRoles` from `activeWorkspace`.
   - `availablePortals` evaluates all active roles independently:
     - `DEVADMIN` role in active roles $\rightarrow$ Developer Admin Portal.
     - `STUDENT` role + valid `student_id` $\rightarrow$ Student Portal.
     - `OFFICER` role + valid active non-expired non-revoked appointment $\rightarrow$ Officer Workspace.
   - Changing `activeWorkspace` toggles local active context without modifying database rows or clearing available roles.
   - Persisted active workspace selection to `@capacitor/preferences` under key `unitap_active_workspace` and restored on app relaunch / page refresh.

3. **DEVADMIN Isolation**:
   - Accounts with only `DEVADMIN` and no `student_id` load directly into the DevAdmin dashboard.
   - Bypassed student profile resolution for non-student accounts in `HomePage.vue` (`useCurrentStudentPortal` is only called when `isStudent` is true).
   - Guarded `/tabs/pass` against accounts without a `student_id`.

4. **Settings & Account Management Polish**:
   - In `SettingsPage.vue`:
     - Display full student name (`Althea Ocampo Abella`) when linked, resolving first, middle, and last names rather than displaying the raw username (`mcc2026-0256`).
     - Display individual badge chips for all active roles (`STUDENT · OFFICER`).
     - Added "Available Portals" card displaying all authorized workspaces with a `CURRENT` badge for the active portal.
     - Provided a one-tap direct switch button (`Switch to this portal`) enabling seamless switching without logging out.
   - In `HomePage.vue`:
     - Added `WorkspaceSwitcher` banner for dual-role users in Officer mode so they can return to Student Portal without visiting Settings.

### 26.4. Verification Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| Targeted Dual-Role & Officer RLS Specification | `npx vitest run tests/unit/dual-role-portal-and-officer-rls.spec.ts` | **16 of 16 PASSED** (Exit code 0) |
| Related Activation & Runtime Specification | `npx vitest run tests/unit/student-activation-and-runtime.spec.ts` | **9 of 9 PASSED** (Exit code 0) |
| Role-Based Database Sync & Activation Suite | `npx vitest run tests/unit/role-sync-and-activation.spec.ts` | **13 of 13 PASSED** (Exit code 0) |
| TypeScript Compiler Check | `npx vue-tsc --noEmit` | **0 errors** (Exit code 0) |
| Production Build | `npm run build` | **SUCCESSFUL** in 30.95s (Exit code 0) |

## 27. Institutional Branding Standardization & Digital Student Pass (2026-11-10)

### 27.1. Problem & Root Cause Analysis

1. **Incorrect Institution Name on Digital Student Pass**:
   - **Symptom**: `StudentPassPage.vue` displayed `MABALACAT CITY COLLEGE` and `College of Computing Studies • CSG`.
   - **Root Cause**: The institution title and subtitle were hardcoded directly in the Vue template markup rather than sourced from a single centralized branding configuration.
   - **Remediation**:
     - Created centralized branding configuration in `src/utilities/branding.ts` (`INSTITUTION_CONFIG`).
     - Standardized authoritative values:
       - `name`: `MINDORO STATE UNIVERSITY`
       - `shortName`: `MinSU`
       - `collegeName`: `College of Computer Studies`
       - `organizationName`: `Computer Studies Government`
       - `organizationAcronym`: `CSG`
       - `passSubtitle`: `College of Computer Studies - CSG`
     - Re-exported configuration from `src/utilities/presentation-formatters.ts`.
     - Updated `src/views/StudentPassPage.vue` to bind directly to `INSTITUTION_CONFIG.name` and `INSTITUTION_CONFIG.passSubtitle`.
     - Updated `src/components/student/StudentFinanceView.vue` acknowledgment receipt header to use `INSTITUTION_CONFIG.name` and `INSTITUTION_CONFIG.organizationName`.
     - Preserved all card geometry, holographic glow overlay, student photo loading, NFC pairing indicators, simulated barcode, and academic validity term stamps.

### 27.2. Verification Results

| Verification Step | Command | Result |
| :--- | :--- | :--- |
| Targeted Digital Pass Branding Specification | `npx vitest run tests/unit/digital-pass-branding.spec.ts` | **3 of 3 PASSED** (Exit code 0) |
| Related Student Portal Specification | `npx vitest run tests/unit/student-portal.spec.ts` | **4 of 4 PASSED** (Exit code 0) |
| TypeScript Compiler Check | `npx vue-tsc --noEmit` | **0 errors** (Exit code 0) |
| Production Build | `npm run build` | **SUCCESSFUL** in 27.59s (Exit code 0) |








