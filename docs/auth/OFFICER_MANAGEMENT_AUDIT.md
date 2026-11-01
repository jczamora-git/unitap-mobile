# UniTap 2.0 Officer Management Security & Architectural Audit

## 1. Executive Summary
This audit inspects the current implementation of Supabase Auth, PostgreSQL schema, RLS policies, SQLite relational models, repository abstractions, role navigation guards, and UI components in UniTap 2.0 to prepare for a complete DevAdmin-controlled Officer Management System.

---

## 2. Current State Analysis

### 2.1 User and Role Tables (`users`, `user_roles`)
- **PostgreSQL (`supabase/migrations/20261031000001_unitap_initial_schema.sql`)**:
  - `user_roles` supports multiple rows per user with columns: `id`, `user_id`, `role` (`'DEVADMIN'`, `'OFFICER'`, `'STUDENT'`), `semester_id`, `assigned_by_user_id`, `assigned_at`, `revoked_at`.
- **SQLite (`src/database/migrations/001_initial.sql`)**:
  - `user_roles` similarly supports multiple rows per user.
- **Multiple Simultaneous Roles Evaluation**:
  - The underlying database schema **already allows** multiple simultaneous role records per user (e.g. one row for `role = 'STUDENT'` and another for `role = 'OFFICER'`).
  - However, the frontend service layer (`SupabaseAuthService` and `AuthService`) collapses roles into a single scalar property (`role = computed(() => this.currentRole.value)`), prioritizing `DEVADMIN > OFFICER > STUDENT`.
  - There is currently no active workspace switcher for users who possess both `STUDENT` and `OFFICER` roles.

### 2.2 Officer Permissions & Appointments
- Currently, officer assignments only exist as a row in `user_roles` with `role = 'OFFICER'`.
- There is **no table or entity** representing specific Officer Appointments, Permission Presets (`ATTENDANCE`, `FINANCE`, `FULL`, `CUSTOM`), appointment date spans (`appointment_start`, `appointment_end`), or organizational scopes (`ORGANIZATION`, `PROGRAM`, `SECTION`, `EVENT`).
- Any user with `role = 'OFFICER'` is treated as having blanket officer capabilities across all operations without granular permission checks.

### 2.3 Student Activation & Account Linking
- `StudentActivationService` and `AccountLinkingService` manage 8-character single-use activation codes for students.
- Activation links a Supabase Auth user to an imported student record in `students`.
- Currently, there is no workflow to prepare a pending officer appointment for an imported student such that activating the student account automatically elevates the user to an authorized Officer without manual intervention.

### 2.4 Navigation Guards & System Setup Routes
- `src/router/index.ts` enforces `requiresDevAdmin` on routes under `/settings/system-setup/*`.
- Current setup routes cover `event-categories`, `year-levels`, `sections`, `academic-years`, and `semesters`.
- Routes for `/settings/system-setup/officers` and `/settings/system-setup/officers/create` are **missing**.

---

## 3. Missing Capabilities & Identified Gaps

| Area | Current Limitation | Required Capability |
| :--- | :--- | :--- |
| **Data Model** | No appointment entity; only coarse `user_roles.role = 'OFFICER'`. | Add `officer_appointments` table with permissions, scope, and lifecycle dates. |
| **Account Scenarios** | DevAdmin can only create raw local officer accounts via `AuthService.createOfficerAccount`. | Support 3 scenarios: Existing Student promotion, Imported Student pending activation, and New Officer email invitation. |
| **Role Granularity** | All officers have all privileges; no separation between Attendance and Finance. | Implement 3 presets (`ATTENDANCE`, `FINANCE`, `FULL`) + Custom permissions matrix. |
| **Multi-Role Handling** | Frontend auth session tracks a single role scalar. | Extend auth service with `roles: UserRole[]` and `activeWorkspace: 'OFFICER' \| 'STUDENT' \| 'DEVADMIN'`. |
| **Workspace Switching** | Multi-role user cannot toggle between Student Portal and Officer Workspace. | Add seamless workspace switcher persisted to Preferences without re-authenticating. |
| **UI Management** | No Officer Management page exists. | Create `/settings/system-setup/officers` (list/filter/expand) and `/settings/system-setup/officers/create` (full creation flow). |
| **Server Authorization** | Client-side checks only; no RLS restricting officer assignments. | Create PostgreSQL RLS & RPC functions ensuring only DEVADMIN can create, suspend, or revoke officer appointments. |

---

## 4. Exact Files Requiring Modification & Creation

### 4.1 Database Migrations & Models
- `supabase/migrations/20261101140000_officer_management.sql` *(New)*: PostgreSQL table `officer_appointments`, indexes, RLS policies, and DevAdmin RPCs.
- `src/database/migrations/005_officer_management.ts` *(New)*: SQLite relational model for offline officer appointments.
- `src/database/migration-runner.ts`: Register Migration v5 and include `officer_appointments` in `validateSchema`.
- `src/types/database.ts`: Add `OfficerAppointmentRecord`, `OfficerPermissionPreset`, `OfficerScopeType`, and `OfficerStatus` interfaces.

### 4.2 Repositories & Services
- `src/database/repositories/officer.repository.ts` *(New)*: Typed SQLite CRUD operations for officer appointments and multi-role assignments.
- `src/services/officer-management.service.ts` *(New)*: Core business logic for Scenarios A, B, and C, permission presets, appointments, suspensions, and revocations.
- `src/services/auth.service.ts`: Support multi-role querying, workspace switching, and appointment permission verification.
- `src/integrations/supabase/auth.service.ts`: Hydrate multiple roles and authoritative officer appointment permissions into the session.
- `src/integrations/supabase/account-linking.service.ts`: Check and activate pending officer appointments upon student claim completion.

### 4.3 Router & User Interface
- `src/router/index.ts`: Register `/settings/system-setup/officers` and `/settings/system-setup/officers/create` with `meta: { requiresDevAdmin: true }`.
- `src/views/settings/SystemSetupHubPage.vue`: Add Officer Management navigation tile.
- `src/views/settings/OfficerManagementPage.vue` *(New)*: DevAdmin officer list with search, active/pending/inactive tabs, expandable rows, and action sheets.
- `src/views/settings/CreateOfficerPage.vue` *(New)*: Full-page creation flow supporting Scenario A, Scenario B, and Scenario C with permission presets and preview.
- `src/components/shared/WorkspaceSwitcher.vue` *(New)*: Smooth workspace switcher for dual-role users.

### 4.4 Test Specifications
- `tests/unit/officer-management.spec.ts` *(New)*: Comprehensive unit tests covering all 3 scenarios, permission presets, suspension, revocation, and multi-role workspace preservation.

