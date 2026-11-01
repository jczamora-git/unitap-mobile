# UniTap 2.0 — Scoped UI Refactoring Specification

## Purpose & Scope Boundaries
This document specifies the precise list of authorized files, exact sections, and scope boundaries for the UI modernization pass. In accordance with the Codex Master Prompt, zero changes to business logic, database migrations, Supabase repositories, NFC listeners, or financial calculations are permitted.

---

## 1. Authorized Files for Modification

### Reusable UI Layer
1. `src/components/ui/UniPagination.vue` (New component)
2. `src/components/ui/UniExpandableRow.vue` (New component)
3. `src/components/ui/UniRecordList.vue` (New component)
4. `src/components/ui/UniTreeView.vue` (New component)
5. `src/components/ui/index.ts` (Export registration)
6. `src/components/ui/UniSelect.vue` (Unified select with action-sheet threshold & z-index)
7. `src/components/ui/UniCard.vue` (Preserve overflow prop)

### Target Views
1. `src/views/FinancePage.vue`
   - Replace hand-crafted `custom-dropdown-container` with `<UniSelect>`.
   - Add `UniPagination` for payments and obligations.
2. `src/views/ReportsPage.vue`
   - Add responsive presentation: `< 768px` renders via `UniExpandableRow` / `UniRecordList`; `≥ 768px` retains tabular view.
   - Add `UniPagination` to student records table/list.
3. `src/views/settings/SectionsPage.vue`
   - Replace flat list with `UniTreeView` (Year Level $\rightarrow$ Sections).
   - Replace native HTML `<select>` with `<UniSelect>`.
   - Use `UniSheet` for Add/Edit Section modal.
4. `src/views/settings/SemestersPage.vue`
   - Replace native `<select>` with `<UniSelect>`.
   - Group semesters hierarchically or present with `UniTreeView`.
5. `src/views/settings/YearLevelsPage.vue`
   - Replace native `<select>` with `<UniSelect>`.
   - Use `UniSheet` for Add/Edit Year Level.
6. `src/views/settings/EventCategoriesPage.vue`
   - Replace native `<select>` with `<UniSelect>`.
   - Use `UniSheet` for Add/Edit Event Category.
7. `src/views/AcademicPage.vue`
   - Replace native `<select>` with `<UniSelect>` for term selection.
8. `src/views/CsvImportPage.vue`
   - Replace native `<select>` with `<UniSelect>` for Semester and Program.
9. `src/views/MakePaymentPage.vue`
   - Replace native `<select>` with `<UniSelect>` for payee student.
10. `src/views/StudentsPage.vue`
   - Add `UniPagination` for student directory list.

---

## 2. Strictly Out of Scope (Protected Files)
The following files and systems are protected and MUST NOT be modified:
- `src/database/migrations/*` (All SQLite migrations)
- `supabase/migrations/*` (All Supabase migrations)
- `src/database/repositories/*` (All database repositories)
- `src/services/nfc.service.ts` (NFC scanner and native session management)
- `src/services/finance.service.ts` (All financial logic, centavo math, payment reversal logic)
- `src/services/student.service.ts` (Student registration and state management)
- `src/services/event.service.ts` (Attendance tracking and session scheduling)
- `src/services/sync/*` (Push sync, initial sync, offline queue)
- `src/integrations/supabase/*` (Auth and remote connections)
- `capacitor.config.ts` (Native package ID and configuration)

---

## 3. Risk Mitigation Plan
- Every change is scoped to the `<template>` and `<style scoped>` blocks of the target `.vue` files.
- All component props are backward-compatible with default values.
- Sequential verification (`pnpm test:unit` $\rightarrow$ `pnpm lint` $\rightarrow$ `pnpm build` $\rightarrow$ `pnpm exec cap sync android`) will be conducted to guarantee zero regressions.

