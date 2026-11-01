# UniTap 2.0 — Component Reusability & Mapping Matrix

## Reusability Strategy
In alignment with the Codex Master Prompt, every identified UI problem was evaluated under the Three-Option Rule:
- **Option A — Reuse**: Use existing component directly.
- **Option B — Extend**: Add backward-compatible prop/variant to existing component without breaking existing callers.
- **Option C — Create**: Build a new generic reusable component when no appropriate primitive exists.

---

## Component Decision & Mapping Matrix

| UI Challenge / Need | Target File(s) | Decision Category | Component Selected / Created | Justification & Architectural Fit |
|---|---|---|---|---|
| Dropdown selector unification & clipping prevention | `FinancePage.vue`, `ReportsPage.vue`, `EventAbsenteesPage.vue`, `SectionsPage.vue`, `SemestersPage.vue`, etc. | **Option B — Extend** | `UniSelect.vue` | Added automatic `actionSheetController` invocation for collections > 3 options, elevated z-index 50, and empty placeholder support. |
| Card clipping child menus | `UniCard.vue`, `ContributionsPage.vue`, `EventAbsenteesPage.vue` | **Option B — Extend** | `UniCard.vue` | Added `overflow?: 'visible' \| 'hidden'` prop with default `'visible'` to eliminate unwanted clipping while allowing explicit overflow bounds when needed. |
| Large data collections & mobile table overflow | `ReportsPage.vue`, `StudentsPage.vue`, `FinancePage.vue` | **Option C — Create** | `UniPagination.vue` | Generic pagination control providing range feedback ("Showing 1–10 of 45"), previous/next touch targets, and page size selection (10/20/50). |
| Mobile tabular records replacement | `ReportsPage.vue`, `FinancePage.vue` | **Option C — Create** | `UniExpandableRow.vue` & `UniRecordList.vue` | Replaces wide multi-column tables on mobile viewports (< 768px) with tap-to-expand accordion rows displaying primary summary and expandable attributes. |
| One-to-many hierarchical structures (Year Level $\rightarrow$ Sections, Academic Year $\rightarrow$ Semesters) | `SectionsPage.vue`, `SemestersPage.vue` | **Option C — Create** | `UniTreeView.vue` | Generic expandable tree navigation component with parent folder headers, count badges, and indented child items with slot support. |
| Short modal forms (Add Section, Edit Section, Add Term) | `SectionsPage.vue`, `SemestersPage.vue`, `YearLevelsPage.vue`, `EventCategoriesPage.vue` | **Option A — Reuse** | `UniSheet.vue` | Standardizes mobile presentation of short forms using bottom sheets with drag handles and backdrop dismiss. |
| Empty states for missing data or filtered results | `ReportsPage.vue`, `FinancePage.vue`, `EventAbsenteesPage.vue`, `StudentsPage.vue` | **Option A — Reuse** | `UniEmptyState.vue` | Unified empty placeholder with customizable icon, title, description, and action button. |
| Segmented filters & tab switching | `FinancePage.vue`, `StudentsPage.vue`, `ContributionsPage.vue` | **Option A — Reuse** | Filter chips / `UniSegmentedControl.vue` | Standardized pill filters with active states and dark mode tokens. |

---

## Export Catalog
All newly created components (`UniPagination.vue`, `UniExpandableRow.vue`, `UniRecordList.vue`, `UniTreeView.vue`) are exported from the single entry point `src/components/ui/index.ts`.

