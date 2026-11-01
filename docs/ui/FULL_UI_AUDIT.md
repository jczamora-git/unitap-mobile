# UniTap 2.0 — Comprehensive UI/UX Audit Matrix

## Executive Summary
This document presents the complete UI and design consistency audit of UniTap 2.0 as mandated by the Codex Master Prompt. Each view and reusable component was inspected for native styling regressions, clipped menus/dialogs, mobile overflow, missing empty states, Light/Dark theme fidelity, and opportunities for reusable component modernization.

---

## Complete UI Audit Matrix

| File | Exact UI Area | Problem Description | Existing Component / Implementation | Proposed Component | Severity & Risk | Scope Action |
|---|---|---|---|---|---|---|
| `src/views/FinancePage.vue` | Academic Period Selector | Hand-coded dropdown menu clipped by parent stacking container; not utilizing unified `UniSelect` | Raw `<div>` custom dropdown with `isSemesterDropdownOpen` | `UniSelect` | **High** / Low Risk | Replace with `UniSelect` (sheet mode for >3 items, floating popover for <=3) |
| `src/views/FinancePage.vue` | Recent Payments & Obligations lists | Flat unpaginated lists can grow indefinitely on mobile | Native list with scroll | `UniPagination` + `UniExpandableRow` | **Medium** / Low Risk | Integrate `UniPagination` with 10/20/50 page size |
| `src/views/ReportsPage.vue` | Student Records Table | Wide tabular layout causes horizontal scrolling and overflow on mobile screens (< 768px); theme contrast issues | Standard `<table>` with overflow-x wrapper | `UniRecordList` + `UniExpandableRow` (mobile) / Responsive Table (desktop) + `UniPagination` | **High** / Low Risk | Responsive toggle: desktop tabular, mobile expandable record rows with pagination |
| `src/views/ReportsPage.vue` | Dark Mode Surfaces | Theme contrast was washed out with white background | Hardcoded surfaces | Standardized `--uni-surface` & `--uni-border` | **High** / Low Risk | Verified dark mode styles matching `#1B1D23` |
| `src/views/EventAbsenteesPage.vue` | Context Bar Selects | Missing empty placeholders when no events or sessions are available; z-index stacking | Native controls / Unlinked selects | `UniSelect` with `emptyPlaceholder` | **Medium** / Low Risk | Bound to `UniSelect` with empty placeholder fallbacks |
| `src/views/settings/SectionsPage.vue` | Section Offerings Hierarchy | Flat card list does not communicate Year Level $\rightarrow$ Section 1-to-many relationship | Flat grid of cards | `UniTreeView` (grouped by Year Level $\rightarrow$ Sections) | **Medium** / Low Risk | Group sections hierarchically with enrollment counts |
| `src/views/settings/SectionsPage.vue` | Filter Bar & Form Dialogs | Inconsistent native `<select>` controls for Year Level, Program, Academic Year, and Status | Native HTML `<select>` | `UniSelect` + `UniSheet` | **Medium** / Low Risk | Replace native selects with `UniSelect`; use `UniSheet` for Add/Edit |
| `src/views/settings/SemestersPage.vue` | Semester Terms & Academic Years | Flat list lacks explicit visual tree binding between Academic Year and its Semesters | Flat card list | `UniTreeView` (Academic Year $\rightarrow$ Semesters) + `UniSelect` | **Medium** / Low Risk | Modernize hierarchy presentation |
| `src/views/settings/SemestersPage.vue` | Term & Status Form Inputs | Native `<select>` used for Semester Term and Status in modal | Native HTML `<select>` | `UniSelect` | **Low** / Low Risk | Replace native selects with `UniSelect` |
| `src/views/settings/YearLevelsPage.vue` | Status selector | Native `<select>` used for Year Level status | Native HTML `<select>` | `UniSelect` | **Low** / Low Risk | Replace native selects with `UniSelect` |
| `src/views/settings/EventCategoriesPage.vue` | Status selector | Native `<select>` used for Event Category status | Native HTML `<select>` | `UniSelect` | **Low** / Low Risk | Replace native selects with `UniSelect` |
| `src/views/AcademicPage.vue` | Term Selection Modal | Native `<select>` used for term selection in Add Term dialog | Native HTML `<select>` | `UniSelect` | **Low** / Low Risk | Replace native select with `UniSelect` |
| `src/views/CsvImportPage.vue` | Semester & Program Selectors | Native `<select>` used for Semester and Program dropdowns | Native HTML `<select>` | `UniSelect` | **Low** / Low Risk | Replace native selects with `UniSelect` |
| `src/views/MakePaymentPage.vue` | Student Selector | Native `<select>` used for choosing payee student | Native HTML `<select>` | `UniSelect` | **Low** / Low Risk | Replace native select with `UniSelect` |
| `src/views/StudentsPage.vue` | Student Directory List | Unpaginated large student roster causes long scrolls on mobile | Unpaginated flat list | `UniPagination` | **Medium** / Low Risk | Add pagination controls for student directory |
| `src/components/ui/UniSelect.vue` | Option List Display & Z-Index | Menu was clipped inside card containers with `overflow: hidden`; needed ActionSheet mode for >3 items | Floating popover | Extended `UniSelect` (actionSheetController for >3 options, elevated z-index 50) | **High** / Low Risk | Implemented and verified |
| `src/components/ui/UniCard.vue` | Clipping of Child Overlays | Default `overflow: hidden` clipped dropdown popovers and tooltips | `overflow: hidden` | `UniCard` with `overflow="visible"` default | **High** / Low Risk | Implemented and verified |

---

## Architectural Verification & Protection
All identified solutions operate exclusively on the presentation template layer and scoped styles. No database schemas, Supabase endpoints, SQLite repositories, NFC listeners, or financial calculations will be altered.

