# Implementation Plan — UniTap

## Phase A: Harness and Foundation
- [x] Baseline verification (build, lint, vitest).
- [x] Create agent development harness (`AGENTS.md`, `.agents/`, `PROJECT_STATE.md`, etc.).
- [ ] Extend Domain Models:
  - Extended Student & Card lifecycle types (`src/types/student.ts`).
  - Event, Schedule, Occurrence, Participant types (`src/types/event.ts`).
  - Attendance Scan attempt & summary types (`src/types/attendance.ts`).
  - Finance, Wallet, Ledger, Charge types (`src/types/finance.ts`).
- [ ] Implement Unified Local Persistence Repositories (`src/storage/`).
- [ ] Update `StudentService` for legacy support and card lifecycle.

## Phase B: Core UniTap Navigation & Design
- [ ] Update branding in `capacitor.config.ts`, `index.html`, and `src/theme/`.
- [ ] Build 5-Tab Navigation in `TabsPage.vue` & `src/router/index.ts` (Home, Events, Scan, Students, Finance).
- [ ] Build Home Dashboard (`src/views/HomePage.vue`) with dynamic metrics and quick actions.
- [ ] Create Settings & Diagnostics view (`src/views/SettingsPage.vue`) retaining existing NFC diagnostics & history.

## Phase C: Event Management Module
- [ ] Event repository and `EventService`.
- [ ] Event list view (`src/views/EventsPage.vue`).
- [ ] Event creation full page (`src/views/CreateEventPage.vue`).
- [ ] Event detail & Occurrence view (`src/views/EventDetailPage.vue`).

## Phase D: NFC Attendance Module
- [ ] Attendance repository and `AttendanceService`.
- [ ] Dedicated Attendance Scanner page (`src/views/AttendanceScanPage.vue` / updated `ScannerPage.vue`).
- [ ] Attendance results feedback panel (Accepted, Duplicate, Unregistered, Ineligible, Closed).
- [ ] Attendance Session Roster view & Manual adjustment modal.

## Phase E: Student Finance & Simulated Wallet Module
- [ ] Finance repository and `FinanceService`.
- [ ] Finance Overview page (`src/views/FinancePage.vue`).
- [ ] Charge management view (`src/views/ChargesPage.vue` & `CreateChargePage.vue`).
- [ ] Student Wallet detail & Simulated Top-up modal (`src/views/StudentWalletPage.vue`).
- [ ] NFC-assisted Payment view (`src/views/MakePaymentPage.vue`).

## Phase F: QA, Unit Tests & Android Verification
- [ ] Write Vitest unit test suite covering student rules, attendance evaluation, and wallet ledger invariants.
- [ ] Run `npx pnpm test:unit -- --run`, fix any regressions.
- [ ] Run `npx pnpm build`.
- [ ] Sync Capacitor Android (`npx cap sync android`).
- [ ] Prepare `DEMO_GUIDE.md`.
