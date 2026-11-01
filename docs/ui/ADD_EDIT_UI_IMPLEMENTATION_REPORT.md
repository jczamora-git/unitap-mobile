# UniTap 2.0 Add/Edit Form Architecture Implementation Report

## 1. Overview
This report documents the correction of the Add/Edit form presentation architecture across UniTap 2.0. Centered modal dialogs (`UniDialog`) have been removed from all record creation and editing flows. Simple forms now use accessible custom bottom sheets (`UniSheet.vue`), complex forms use dedicated full-page routes, and centered modal dialogs are retained exclusively for destructive confirmations and critical status warnings.

---

## 2. Forms Converted to Bottom Sheets (`UniSheet.vue`)

| Management Screen | Prior Presentation | New Presentation | Fields Present | Preserved Operations |
|---|---|---|---|---|
| **Create / Edit Semester** (`SemestersPage.vue`) | Centered `UniDialog` | Custom Bottom Sheet (`UniSheet.vue`) | Academic Year, Term, Starts On, Ends On, Status | `SystemSetupService.createSemester`, `SystemSetupService.updateSemester`, validation, active semester logic |
| **Create / Edit Academic Year** (`AcademicYearsPage.vue`) | Centered `UniDialog` | Custom Bottom Sheet (`UniSheet.vue`) | Label, Starts On, Ends On, Status | `SystemSetupService.createAcademicYear`, `SystemSetupService.updateAcademicYear`, validation |
| **Add / Edit Year Level** (`YearLevelsPage.vue`) | Centered `UniDialog` | Custom Bottom Sheet (`UniSheet.vue`) | Level Number, Display Name, Status, Sort Order | `SystemSetupService.createYearLevel`, `SystemSetupService.updateYearLevel`, numeric level constraints |
| **Create / Edit Event Category** (`EventCategoriesPage.vue`) | Centered `UniDialog` | Custom Bottom Sheet (`UniSheet.vue`) | Category Name, Classification Code, Description, Status, Sort Order | `SystemSetupService.createEventCategory`, `SystemSetupService.updateEventCategory` |
| **Create / Edit Section** (`SectionsPage.vue`) | Centered `UniDialog` | Custom Bottom Sheet (`UniSheet.vue`) | Section Name, Year Level, Program, Academic Year, Status | `SystemSetupService.createSection`, `SystemSetupService.updateSection`, dependent options |

---

## 3. Dedicated Full-Page Forms (Rule B)

| Feature | Route | Component | Complexity / Rationale |
|---|---|---|---|
| **Create Event** | `/events/create` | `CreateEventPage.vue` | 8+ fields, multi-session occurrence scheduling, fine rules, and target audience setup |
| **Edit Event** | `/events/:id/edit` | `CreateEventPage.vue` (Edit Mode) | Full-page event parameter and audience configuration |
| **Add Student** | `/register-student` | `RegisterStudentPage.vue` | Multi-field roster registration with live native NFC card tap |
| **Edit Student Profile** | `/students/:id/edit` | `EditStudentPage.vue` | 7 academic and demographic fields with validation |
| **Cashier / Record Payment** | `/finance/pay` | `MakePaymentPage.vue` | Cashier workflow with ledger allocation, change computation, and printable receipt |
| **Manual Charge** | `/finance/charges/create` | `CreateChargePage.vue` | Obligation issuance with live student ledger balance preview |
| **CSV Roster Import** | `/students/import` | `CsvImportPage.vue` | File upload, parsing, mapping, error sanitization, and bulk database insertion |

---

## 4. Retained Confirmation Dialogs (Rule C)
Centered dialogs (`UniDialog`) remain strictly confirmation-only and contain no Add/Edit forms:
- `SemestersPage.vue`: Activate Semester confirmation dialog (`showActivateConfirm`)
- `AcademicYearsPage.vue`: Set Active Academic Year confirmation dialog (`showStatusConfirm`)
- `EventCategoriesPage.vue`: Delete Category confirmation dialog (`showDeleteConfirm`)
- `StudentProfilePage.vue`: Delete Student (`showDeleteDialog`), Deactivate RFID (`showRemoveRfidDialog`)
- `EventDetailPage.vue`: Delete Event confirmation (`showAlert`)
- `ChargesPage.vue`: Void Charge justification confirmation (`showVoidAlert`)
- `HistoryPage.vue`: Clear NFC Scans confirmation (`showClearDialog`)
- `SettingsPage.vue`: Sign Out confirmation (`showSignOutAlert`), Reset Demo Data confirmation (`showResetAlert`)

---

## 5. Overlay, Dropdown Stacking & Positioning Corrections
- **Sheet Stacking**: `UniSheet.vue` teleports to `document.body` with `z-index: 9999` and an accessible backdrop with keyboard listener (`Escape` key closes sheet).
- **Nested Select Positioning**: `UniSelect.vue` active dropdowns use high z-index (`z-index: 1000` for dropdown menu) to ensure options are never clipped by sheet boundaries.
- **Responsive Layout**: On mobile, sheets slide from the bottom with Android safe-area bottom insets (`calc(16px + var(--ion-safe-area-bottom, 0px))`). On desktop ($\ge 768\text{px}$), sheets are anchored with max-width 580px.
- **Dark Mode**: All sheets and forms inherit design tokens (`var(--uni-surface)`, `var(--uni-border)`, `var(--uni-text)`), with explicit `:global(.dark)` rules for inputs and containers.

---

## 6. Files Modified
- `src/components/ui/UniSheet.vue`
- `src/views/settings/SemestersPage.vue`
- `src/views/settings/AcademicYearsPage.vue`
- `src/views/settings/YearLevelsPage.vue`
- `src/views/settings/EventCategoriesPage.vue`
- `src/views/settings/SectionsPage.vue`
- `src/views/EditStudentPage.vue` *(New full-page route)*
- `src/views/StudentProfilePage.vue`
- `src/views/CreateEventPage.vue`
- `src/views/EventDetailPage.vue`
- `src/router/index.ts`
- `docs/ui/ADD_EDIT_FORM_AUDIT.md` *(New)*
- `docs/ui/ADD_EDIT_UI_IMPLEMENTATION_REPORT.md` *(New)*
- `tests/unit/add-edit-forms-architecture.spec.ts` *(New targeted test suite)*

---

## 7. Verification Results
- **Unit Tests**: `pnpm test:unit -- --run` $\rightarrow$ **PASS** (18 test files, 104 tests passing, Exit 0)
- **Linter**: `pnpm lint` $\rightarrow$ **PASS** (0 errors, 0 warnings, Exit 0)
- **Production Typecheck & Build**: `pnpm build` (`vue-tsc && vite build`) $\rightarrow$ **PASS** (Exit 0)
- **Capacitor Android Sync**: `pnpm exec cap sync android` $\rightarrow$ **PASS** (Exit 0)

