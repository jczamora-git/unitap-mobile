# UniTap 2.0 Add/Edit Form Audit

## Executive Summary
This audit inspects every Add/Edit form and modal across the UniTap 2.0 application.
In accordance with the **Strict Form Presentation Rules**:
- **Rule A (Short Forms, 1–4 simple fields)**: Must use custom bottom sheets (`UniSheet.vue`). Centered modal dialogs (`UniDialog`) must NOT be used for Add/Edit forms.
- **Rule B (Long Forms, 5+ fields or complex workflows)**: Must use dedicated full-page routes.
- **Rule C (Confirmation Dialogs)**: Centered `UniDialog` is retained ONLY for destructive actions (Delete, Deactivate, Void, Clear History, Reset) or critical confirmation steps (Semester Activation).

---

## Detailed Audit Matrix

| Management Area | Source File | Current Presentation | Field Count & Complexity | Proposed Presentation | Handlers Preserved | Regression Risk |
|---|---|---|---|---|---|---|
| **Semesters** (Create / Edit) | `src/views/settings/SemestersPage.vue` | Centered `UniDialog` | 4–5 fields (AY, Term, Starts On, Ends On, Status) | Custom Bottom Sheet (`UniSheet.vue`) | `SystemSetupService.createSemester`, `SystemSetupService.updateSemester` | Low. Business logic, activation transactions preserved. |
| **Academic Years** (Create / Edit) | `src/views/settings/AcademicYearsPage.vue` | Centered `UniDialog` | 3–4 fields (Label, Starts On, Ends On, Status) | Custom Bottom Sheet (`UniSheet.vue`) | `SystemSetupService.createAcademicYear`, `SystemSetupService.updateAcademicYear` | Low. Form validation and status toggle preserved. |
| **Year Levels** (Add / Edit) | `src/views/settings/YearLevelsPage.vue` | Centered `UniDialog` | 2–3 fields (Level Number, Display Name, Status) | Custom Bottom Sheet (`UniSheet.vue`) | `SystemSetupService.createYearLevel`, `SystemSetupService.updateYearLevel` | Low. Level constraint preserved. |
| **Event Categories** (Create / Edit) | `src/views/settings/EventCategoriesPage.vue` | Centered `UniDialog` | 2–3 fields (Name, Code, Status) | Custom Bottom Sheet (`UniSheet.vue`) | `SystemSetupService.createEventCategory`, `SystemSetupService.updateEventCategory` | Low. Retains delete confirmation dialog. |
| **Sections** (Create / Edit) | `src/views/settings/SectionsPage.vue` | Centered `UniDialog` | 4–5 fields (Name, Year Level, Program, AY, Status) | Custom Bottom Sheet (`UniSheet.vue`) | `SystemSetupService.createSection`, `SystemSetupService.updateSection` | Low. Dependent selectors and tree view preserved. |
| **Events** (Create) | `src/views/CreateEventPage.vue` | Dedicated Full-Page Route (`/events/create`) | 8+ fields with multi-session scheduling & fines | Preserve Full-Page Route | `EventsRepository.createEventWithOccurrences` | None. Complies with Rule B. |
| **Events** (Edit) | `src/router/index.ts` | Not explicitly mapped as full page | 8+ fields | Full-Page Route (`/events/:id/edit`) reusing `CreateEventPage.vue` | `EventsRepository.updateEvent` | None. |
| **Students** (Add / Register) | `src/views/RegisterStudentPage.vue` | Dedicated Full-Page Route (`/register-student`) | 7+ fields with NFC hardware scanner | Preserve Full-Page Route (`/register-student`) | `studentService.registerStudent` | None. Complies with Rule B. |
| **Student Profile** (Edit) | `src/components/EditStudentModal.vue` / `StudentProfilePage.vue` | Full-screen `ion-modal` | 7 fields (ID, First, Middle, Last, Year, Sec, Course) | Route `/students/:id/edit` (or dedicated sheet/page) | `studentService.updateStudent` | Low. Preserves DTO and validation. |
| **Contributions** (Assign Bulk) | `src/views/ContributionsPage.vue` | Custom Bottom Sheet (`UniSheet.vue`) | 5 fields (Title, Amount, Due Date, Notes, Scope) | Preserve Bottom Sheet (`UniSheet.vue`) | `financeService.createBulkContribution` | None. Already using custom bottom sheet. |
| **Absentees Bulk Fines** | `src/views/EventAbsenteesPage.vue` | Custom Bottom Sheet (`UniSheet.vue`) | 4 fields (Rule, Title, Amount, Due Date, Notes) | Preserve Bottom Sheet (`UniSheet.vue`) | `financeService.assessBulkFines` | None. Already using custom bottom sheet. |
| **Make Payment** | `src/views/MakePaymentPage.vue` | Dedicated Full-Page Route (`/finance/pay`) | Cashier workflow with ledger & receipt generation | Preserve Full-Page Route | `financeService.processPayment` | None. Complies with Rule B. |
| **Create Charge** | `src/views/CreateChargePage.vue` | Dedicated Full-Page Route (`/finance/charges/create`) | 6 fields with student search & balance preview | Preserve Full-Page Route | `financeService.issueManualCharge` | None. Complies with Rule B. |
| **CSV Import** | `src/views/CsvImportPage.vue` | Dedicated Full-Page Route (`/students/import`) | Multi-step file parsing, preview & column mapping | Preserve Full-Page Route | `csvImportService.importRoster` | None. Complies with Rule B. |

---

## Retained Confirmation Dialogs (Rule C Compliant)

The following modal dialogs are strictly confirmation-only and DO NOT embed Add/Edit forms:
1. `SettingsPage.vue`: Sign Out confirmation dialog (`showSignOutAlert`), Reset Sample Data confirmation dialog (`showResetAlert`).
2. `EventDetailPage.vue`: Delete Event confirmation dialog (`showAlert`).
3. `StudentProfilePage.vue`: Delete Student confirmation dialog (`showDeleteDialog`), Deactivate RFID confirmation dialog (`showRemoveRfidDialog`).
4. `ChargesPage.vue`: Void Charge destructive confirmation dialog (`showVoidAlert`).
5. `HistoryPage.vue`: Clear History destructive confirmation dialog (`showClearDialog`).
6. `SemestersPage.vue`: Activate Semester confirmation dialog (`showActivateConfirm`).
7. `EventCategoriesPage.vue`: Delete Category confirmation dialog (`showDeleteDialog`).
8. `AcademicYearsPage.vue`: Set Active Academic Year confirmation dialog (`showActivateConfirm`).

---

## Action Plan
1. **SemestersPage.vue**: Replace centered `UniDialog` for Create/Edit Semester with `UniSheet`. Fix dropdown positioning and ensure buttons are accessible.
2. **AcademicYearsPage.vue**: Replace centered `UniDialog` for Create/Edit Academic Year with `UniSheet`.
3. **YearLevelsPage.vue**: Replace centered `UniDialog` for Add/Edit Year Level with `UniSheet`.
4. **EventCategoriesPage.vue**: Replace centered `UniDialog` for Create/Edit Event Category with `UniSheet`. Retain Delete confirmation dialog.
5. **SectionsPage.vue**: Replace centered `UniDialog` for Create/Edit Section with `UniSheet`.
6. **Student Edit Route**: Support `/students/:id/edit` full-page route using `EditStudentPage.vue` (or full-page form layout) according to Rule B.
7. **Verification**: Run unit tests, linter, production build, and Capacitor sync sequentially.

