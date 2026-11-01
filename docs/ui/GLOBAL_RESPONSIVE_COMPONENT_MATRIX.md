# Global Responsive Component Matrix

This matrix documents the shared UI components audited, their responsive behaviors across target device widths, and consumer pages benefiting from the design token updates.

---

## 1. Shared Components Audited

| Component | Target File | Breakpoints & Fluid Rules | Consumer Pages |
| :--- | :--- | :--- | :--- |
| **UniCard** | `src/components/ui/UniCard.vue` | Uses `--uni-card-p-*` fluid clamp tokens. At `<= 380px`, `p-md` scales from 16x18px to 12x14px; `p-lg` scales from 20x22px to 14x16px. | `EventsPage`, `FinancePage`, `EventDetailPage`, `ReportsPage`, `CsvImportPage`, `SystemSetupHubPage`, `YearLevelsPage`, `SectionsPage`, `SemestersPage`, `AcademicYearsPage`, `EventCategoriesPage` |
| **UniHeroCard** | `src/components/ui/UniHeroCard.vue` | At `<= 380px`, internal padding drops from 22x20px to 16x14px, radius adjusts to 18px. | `HomePage`, `StudentWalletPage`, `NfcCheckerPage`, `DevicePage` |
| **UniSheet** | `src/components/ui/UniSheet.vue` | At `<= 380px`, header padding drops to `0 14px 10px`, scroll body to `12px 14px`, footer to `10px 14px 0`. | `SectionsPage`, `SemestersPage`, `AcademicYearsPage`, `EventCategoriesPage`, `YearLevelsPage`, `EditStudentPage`, `ChargesPage` |
| **UniDialog** | `src/components/ui/UniDialog.vue` | At `<= 380px`, overlay padding tightens to 16px, card padding reduces to 20x16x16px to prevent vertical viewport overflow. | `StudentProfilePage`, `SectionsPage`, `AcademicYearsPage`, `SemestersPage`, `EventCategoriesPage`, `YearLevelsPage`, `ChargesPage` |
| **UniExpandableRow**| `src/components/ui/UniExpandableRow.vue` | Updated breakpoint from 359px to 380px. At `<= 380px`, row-header and row-body paddings tighten to 10x12px, actions stretch with 80px min-width. | `StudentsPage`, `EventAbsenteesPage`, `ChargesPage`, `EventCategoriesPage`, `SectionsPage`, `AcademicYearsPage`, `SemestersPage`, `YearLevelsPage` |
| **UniKpiCarousel** | `src/components/ui/UniKpiCarousel.vue` | Updated breakpoint from 359px to 380px. At `<= 380px`, cards snap to `82%` width with 14px padding. | `ReportsPage`, `FinancePage` |
| **UniSegmentedControl**| `src/components/ui/UniSegmentedControl.vue`| At `<= 380px`, control height drops from 44px to 40px; segment items tighten to 12px text, 0 6px padding. | `FinancePage`, `ReportsPage`, `AttendanceScanPage` |
| **UniSelect** | `src/components/ui/UniSelect.vue` | Truncated select trigger text using `flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`. | `CsvImportPage`, `RegisterStudentPage`, `CreateEventPage`, `ReportsPage`, `SectionsPage`, `SemestersPage` |
| **UniButton** | `src/components/ui/UniButton.vue` | Responsive height and compact touch padding, maintaining accessible 44px touch target on mobile via pseudo-element tap areas. | Application-wide across all 35 views |
| **UniBadge** | `src/components/ui/UniBadge.vue` | Inline-flex with compact padding (3px 8px), font-size 11px, preventing unwanted wrap in card headers. | Application-wide across all record rows and cards |

---

## 2. Density Targets Across Viewport Widths

| Target Device | Viewport Width | Layout Gutters | Card Padding (`p-md`) | Control Height | Expandable Row Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Extra Compact** | 320px | 12px | 12px 14px | 40px | Stretched action buttons, 10x12px padding |
| **Compact Baseline (Samsung A55)** | 360px | 12px | 12px 14px | 40px | Stretched action buttons, 10x12px padding |
| **Standard Mobile (iPhone 13/14)** | 390px | 16px | 16px 18px | 44px | Standard action buttons |
| **Comfortable Mobile (iPhone 16 PM)**| 440px | 16px | 16px 18px | 44px | Standard action buttons |
| **Tablet** | 768px | 24px | 16px 18px | 44px | Multi-column grid layout |
| **Desktop** | 1024px+ | 24px | 20px 22px | 44px | Wide container layout (max-width: 1200px) |

