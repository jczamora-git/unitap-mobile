# UniTap 2.0 Offline-First Synchronization & Architecture Audit

## 1. Executive Summary

UniTap 2.0 operates as an offline-first mobile and desktop application for student identification, event attendance tracking, and financial collection.
The data architecture uses a hybrid model:
- **Cloud Backend**: Supabase (PostgreSQL with Auth, Row-Level Security, Storage, and Realtime channels).
- **Client Cache**: Local SQLite (34 tables via WebAssembly `sql.js` in browser/testing, and `@capacitor-community/sqlite` on Android).
- **State Bridge**: Bidirectional push/pull sync engine with an offline `sync_outbox` and cursor-tracked `sync_state`.

This audit assesses the current implementation against strict security, role-based scoping, account isolation, auto/manual sync control, and user experience requirements under Philippine Republic Act No. 10173 (Data Privacy Act of 2012).

---

## 2. Inventory of Existing Synchronization Services

| Service File | Primary Responsibility | Audit Findings & Vulnerabilities |
|---|---|---|
| `src/services/sync/sync-manager.ts` | Orchestrates push, pull, and periodic intervals | Runs a hardcoded 60s `setInterval` unconditionally. No concept of **Automatic** vs **Manual** mode. Does not register app lifecycle (foreground resume) or network reconnection listeners. |
| `src/services/sync/sync-status.service.ts` | Reactive sync & hydration state store | Tracks `SyncState` and `HydrationState`. Missing clear mappings for user-facing minimal display states (`Up to Date`, `Updating`, `Offline`, `Waiting to Sync`, `Needs Attention`, `Update Failed`). |
| `src/services/sync/sync-scope.service.ts` | Defines tables required per role (`DEVADMIN`, `OFFICER`, `STUDENT`) | Role scoping for hydration tables is coarse. `STUDENT` receives tables that reference all student IDs if not filtered at query time. `payment_allocations` query attempts to filter on non-existent `student_id`. |
| `src/services/sync/initial-sync.service.ts` | Downloads initial database on first login | `isHydrated()` checks global `sync_state` device table without verifying `user_id`. When User A logs out and User B logs in, User B falsely bypasses initial hydration and accesses User A's cached personal records. |
| `src/services/sync/pull-sync.service.ts` | Incremental change pull via RPC or polling | Incremental table polling (`events`, `attendance_records`, `student_obligations`, `payments`) does not apply user role scoping when pulling updates, potentially leaking other students' obligations. |
| `src/services/sync/push-sync.service.ts` | Processes `sync_outbox` to Supabase | Maps entity types to tables and pushes `CREATE`, `UPDATE`, `VOID`. Handles unique collision (23505) via `ConflictService`. Does not check if the active session user matches `actor_user_id`, risking upload under wrong identity. |
| `src/services/sync/realtime-sync.service.ts` | Subscribes to Supabase Realtime channels | Subscribes globally to `attendance_records`, `payments`, `student_obligations`. Triggers immediate `pullRemoteChanges()` without debounce or throttling, and does not stop on logout. |
| `src/services/sync/conflict.service.ts` | Logs conflicts to `sync_conflicts` table | Records collision to local SQLite. Lacks automated re-check or server-guided conflict reconciliation for concurrent financial transactions. |

---

## 3. Critical Security & Privacy Findings

### Finding A: Account Switching Data Leakage (High Severity)
- **Problem**: `InitialSyncService.isHydrated()` queries:
  ```sql
  SELECT last_success_at FROM sync_state LIMIT 1
  ```
  This record is tied only to `dev_default`. When Student A completes onboarding, `sync_state` is populated. When Student A logs out and Student B logs in on the same shared Android terminal, `isHydrated()` returns `true`. Student B is redirected directly to `/tabs/home` and views Student A's locally cached profile, enrollment details, and payment history.
- **Remediation**:
  1. Store the authenticated `user_id` in `sync_state` (`hydrated_user_id`).
  2. In `isHydrated(userId)`, verify that the current local database was hydrated for `userId`.
  3. On account switch or role change, safely purge private user records (`students`, `student_enrollments`, `attendance_records`, `student_obligations`, `payments`) while preserving global academic structure and pending offline outbox operations.

### Finding B: Missing Auto vs Manual Sync Preferences (Medium Severity)
- **Problem**: Currently, `SyncManager.start()` unconditionally runs background polling every 60 seconds. On mobile devices with metered cellular data, this drains battery and bandwidth. Users cannot choose Manual Sync.
- **Remediation**:
  1. Create `SyncPreferenceService` storing `'AUTOMATIC' | 'MANUAL'` per user via `@capacitor/preferences`.
  2. In `AUTOMATIC` mode: trigger sync on app startup, login, network reconnection (`window.addEventListener('online')`), foreground resume (`App.addListener('appStateChange')`), and Realtime events (debounced to 3000ms).
  3. In `MANUAL` mode: disable routine polling and noncritical triggers; display explicit **Sync Now** and **Pending Changes** controls in Settings.

### Finding C: Returning-User Update Experience Gap (Medium Severity)
- **Problem**: When a returning user's local database requires rehydration (e.g., after an intentional cache refresh, role scope update, or corrupted cursor), the system previously had only the full Windows OOBE setup screen (`UniWelcomeSetup.vue`), which treats the returning user as a brand-new user.
- **Remediation**:
  1. Create a dedicated lightweight returning-user update component: `UniDataUpdateScreen.vue`.
  2. Display non-technical reassuring copy: *"Updating your data"*, *"Making sure your information is current"*, *"Getting everything ready"*.
  3. If offline or failed, offer *"Try Again"* and *"Continue Offline"* (only if valid authorized cached data exists).

### Finding D: Role Scoping Query Mismatch on Initial & Incremental Sync (High Severity)
- **Problem**:
  1. `InitialSyncService.ts` line 49 checks:
     `else if (['student_enrollments', 'attendance_records', 'student_obligations', 'payments', 'event_participants'].includes(tableName))`
     and appends `.eq('student_id', studentId)`.
     However, `payment_allocations` table has no `student_id` column—it has `payment_id` and `obligation_id`. Querying `student_id` on `payment_allocations` throws an error.
  2. For `OFFICER` roles: Officers only require operational records for active/assigned semesters and sections, not the entire multi-year database.
- **Remediation**:
  1. Restructure `SyncScopeService` to provide exact table query filters per role.
  2. For `STUDENT`, query `payment_allocations` matching the student's authorized payment IDs, or link through `student_obligations`.
  3. For `OFFICER`, scope student profiles and attendance records by active semester.

---

## 4. Change Scope & Preservation Contract

The following core modules MUST be preserved without alteration:
- Native NFC Scanner & Normalizer (`src/services/nfc.service.ts`)
- Integer Centavos financial calculations (`src/utilities/finance-formatters.ts`)
- SQLite schema migrations v1, v2, v3
- Student Attendance check-in and checkout algorithms
- Existing UI layouts and theme tokens (`tokens.css`, `variables.css`)

