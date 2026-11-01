# UniTap 2.0 Sheet Navigation & Button Audit Matrix

## Overview
This audit inspects the UniTap 2.0 application for:
1. **Nested Selection Sheets**: Custom filter bottom sheets invoking secondary modal overlays / ActionSheets rather than keeping navigation inside the persistent sheet container.
2. **Inconsistent Primary Button Colors**: Custom `<button>` elements utilizing mint backgrounds (`#10b981` / dark mode `--uni-primary`) instead of the standardized dark teal primary variant (`--uni-btn-primary-bg: #0F766E` / `#0D9488`).
3. **Verbose Add/New Action Labels**: Management screen buttons containing long redundant labels (e.g., `+ New Section`, `+ New Semester`) instead of the standardized compact `+ New` button with descriptive accessibility attributes.

---

## Audit Matrix

| File | UI Area | Problem | Root Cause | Component to Reuse | Required Change |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `src/views/settings/SectionsPage.vue` | Year Level, Program & Academic Year Filter selectors in `UniFilterSheet` | Nested selection sheet overlay opening above filter sheet | `UniSelect` invokes Ionic `actionSheetController` (separate modal overlay with secondary backdrop) when options count > 3 | `UniFilterSheet` & `UniSelect` (`presentation="embedded"`) via `UniSheetNavigator` | Switch `UniFilterSheet` to internal single-sheet navigation; update `UniSelect` to embedded mode inside sheet container |
| `src/views/settings/SectionsPage.vue` | Toolbar New Action | Button renders bright mint (`#10b981` / `#5EEAD4`) with verbose label `New Section` | Custom `<button class="btn-create">` with hardcoded `background: var(--uni-primary, #10b981)` | `UniButton` (`variant="primary"`, `size="sm"`, `:icon="addOutline"`) | Replace custom button with `UniButton`, set visible label to `New`, and add `aria-label="Create new section"` |
| `src/views/ReportsPage.vue` | Academic Period & Obligation Type Filter selectors in `UniFilterSheet` | Potential nested overlay when opening dropdown within filter sheet | `UniSelect` default dropdown mode inside bottom sheet | `UniFilterSheet` & `UniSelect` (`presentation="embedded"`) via `UniSheetNavigator` | Use embedded selection mode within the single filter sheet navigator |
| `src/views/settings/AcademicYearsPage.vue` | Toolbar New Action | Verbose label `New Academic Year` and custom mint button styling | Local `.btn-create` class with `background: var(--uni-primary, #10b981)` | `UniButton` (`variant="primary"`, `size="sm"`, `:icon="addOutline"`) | Replace with `UniButton`, compact label `New`, and `aria-label="Create new academic year"` |
| `src/views/settings/EventCategoriesPage.vue` | Toolbar New Action | Verbose label `New Category` and custom mint button styling | Local `.btn-create-category` class with `background: var(--uni-primary, #10b981)` | `UniButton` (`variant="primary"`, `size="sm"`, `:icon="addOutline"`) | Replace with `UniButton`, compact label `New`, and `aria-label="Create new event category"` |
| `src/views/settings/SemestersPage.vue` | Toolbar New Action | Verbose label `New Semester` and custom mint button styling | Local `.btn-create` class with `background: var(--uni-primary, #10b981)` | `UniButton` (`variant="primary"`, `size="sm"`, `:icon="addOutline"`) | Replace with `UniButton`, compact label `New`, and `aria-label="Create new semester"` |
| `src/views/settings/YearLevelsPage.vue` | Toolbar New Action | Verbose label `New Year Level` and custom mint button styling | Local `.btn-create` class with `background: var(--uni-primary, #10b981)` | `UniButton` (`variant="primary"`, `size="sm"`, `:icon="addOutline"`) | Replace with `UniButton`, compact label `New`, and `aria-label="Create new year level"` |
| `src/views/AcademicPage.vue` | Toolbar New Action | Custom button with `+ New Term` | Local `.btn-create` button with raw styling | `UniButton` (`variant="primary"`, `size="sm"`, `:icon="addOutline"`) | Replace with `UniButton`, compact label `New`, and `aria-label="Create new semester term"` |
| `src/components/ui/UniButton.vue` | Primary button scoped styling | Ensure dark mode parent selectors (`:global(.dark)` and `:global(.ion-palette-dark)`) correctly apply `#0D9488` | Scoped CSS requires `:global()` wrapper for document-level classes | `UniButton` | Add `:global(.dark)` and `:global(.ion-palette-dark)` rules to `.uni-btn-primary` |
| `src/components/ui/UniFilterSheet.vue` | Content presentation | Lacks internal view navigation between filter form and selection subviews | Single-view slot container without state machine or back navigation | `UniSheetNavigator` | Integrate internal view navigation so child selectors swap content within the same sheet |
| `src/components/ui/UniSelect.vue` | Selection trigger & presentation mode | Opens standalone popup/action sheet regardless of parent container | No `presentation="embedded"` support or delegation to sheet navigator | `UniSelect` | Add `presentation?: 'dropdown' \| 'embedded'` prop to delegate selection views to parent navigator |

---

## Component Architectural Strategy

### 1. `UniSheetNavigator.vue` (New / Reusable)
- Manages internal view stack (`['root', 'selection']`).
- Emits / provides `pushView(viewId, title, meta)`, `popView()`, `resetToRoot()`, and navigation state (`canGoBack`, `currentTitle`).
- Handles transitions (`sheet-nav-slide`), animated smooth content replacement.
- Handles built-in selection list rendering with checkmarks, labels, badges, and immediate auto-pop upon option selection.

### 2. `UniFilterSheet.vue` (Refinement)
- Wraps internal contents inside `UniSheetNavigator`.
- When on root view: Displays filter avatar icon, title, active count badge, filter fields, and `[ Reset ]` / `[ Apply Filters ]` buttons.
- When on selection subview: Displays `< Back` button with chevron icon and view title in header. Automatically hides footer action buttons to dedicate full screen height to option list.
- Intercepts Escape / Back gestures to navigate backwards internally before closing sheet.

### 3. `UniSelect.vue` (Refinement)
- Adds `presentation?: 'dropdown' | 'embedded'`.
- In embedded mode: renders as row trigger with display label and trailing chevron forward `>` (`chevronForwardOutline`).
- On tap: notifies parent `UniSheetNavigator` to push the selection view, passing the options and current value.

### 4. `UniButton.vue` & Management Views
- Standardizes primary button color (`#0F766E` Light / `#0D9488` Dark) with white text.
- Replaces custom `.btn-create` with `UniButton variant="primary" size="sm" :icon="addOutline"`.
- Sets visible label to `New` with descriptive `aria-label`.

