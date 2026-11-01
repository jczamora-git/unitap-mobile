# UniTap 2.0 Responsive UI Scope & Implementation Plan

## 1. Scope Boundaries
This responsive optimization pass targets purely frontend layout, typography wrapping, card presentation, and viewport adaptation:

### In Scope
1. **`src/components/ui/UniPageHeader.vue`**:
   - Container max-width updated from static 580px to responsive 1200px.
   - Title wrapping enabled with responsive font clamp (`clamp(18px, 5vw, 22px)`).
   - Trailing action row wrapping support for narrow mobile screens ($\le 380\text{px}$).
   - Subtitle word-break and natural wrapping.
2. **`src/theme/custom.css`**:
   - Fluid `.page-container` supporting responsive widths (`max-width: 1200px` on desktop, adaptive 12px padding on $\le 359\text{px}$).
   - Responsive `.safe-content` horizontal padding.
3. **`src/components/ui/UniKpiCarousel.vue`**:
   - Responsive KPI card amount font sizing (`clamp(20px, 5.5vw, 26px)`).
   - Prevent horizontal document overflow while preserving internal snap-scrolling.
4. **`src/components/ui/UniExpandableRow.vue`**:
   - Natural wrapping for `.row-title` and `.row-subtitle`.
   - Responsive action button wrapping (`flex-wrap: wrap`) in `.body-actions`.
5. **`src/views/settings/EventCategoriesPage.vue`**:
   - Refactor category cards to use `UniExpandableRow.vue`.
   - Collapsed state: Name, Code badge, Status pill, Linked events count, and chevron.
   - Expanded state: Description, Code, Sort Order, and dedicated touch buttons (`[ Edit ] [ Deactivate ] [ Delete ]`).
6. **`src/views/settings/SemestersPage.vue`**:
   - Refactor semester cards to use `UniExpandableRow.vue`.
   - Collapsed state: Term name, Academic Year tag, Status pill, Date range.
   - Expanded state: Enrolled count, Event count, Date details, and action buttons (`[ Edit ] [ Set as Active ]` / active indicator).
7. **`src/views/ReportsPage.vue`**:
   - Unabbreviated title: "Offline Financial Reports".
   - Adaptive wrapping for `.filter-top-row` to prevent collision between period text and Filters button on narrow viewports.
8. **Settings & Management Toolbars**:
   - Ensure search bars and New buttons wrap gracefully on screens $\le 360\text{px}$.

### Protected / Strictly Out of Scope
- No changes to database repositories, SQLite migrations, or Supabase queries.
- No changes to business logic (fines calculation, payment processing, attendance scanning).
- No changes to authentication or sync outbox pipelines.
- No global font overrides (e.g. `* { font-size: 12px !important; }`).

