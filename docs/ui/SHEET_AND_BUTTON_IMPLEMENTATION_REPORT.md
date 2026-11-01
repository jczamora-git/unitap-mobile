# UniTap 2.0 Sheet Navigation & Button Standardization — Implementation Report

## 1. Original Problems
1. **Nested Selection Sheets & Duplicate Backdrops**:
   - In `SectionsPage.vue` (and `ReportsPage.vue`), opening the filter bottom sheet and tapping an option field (e.g. Year Level) opened a second overlay (an Ionic `ActionSheet` or popover) on top of the original sheet.
   - This created stacked backdrops, body scroll conflicts, z-index glitches, and awkward dual-dismiss interactions.
2. **Inconsistent Primary Button Colors**:
   - Add/New actions on management pages (`SectionsPage`, `SemestersPage`, `AcademicYearsPage`, `EventCategoriesPage`, `YearLevelsPage`) rendered with bright mint backgrounds (`#10b981` / dark mode `--uni-primary`), whereas `Apply Filters` and standard actions used dark teal (`--uni-btn-primary-bg: #0F766E` / `#0D9488`).
3. **Verbose Add/New Labels**:
   - Buttons displayed redundant labels such as `+ New Section`, `+ New Semester`, `+ New Academic Year`, `+ New Category`, and `+ New Year Level` despite already having clear page headers.

---

## 2. Verified Root Causes
1. **Dropdown / ActionSheet Delegation**: `UniSelect.vue` previously triggered an Ionic `actionSheetController.create()` modal overlay for option lists $> 3$ items, unaware of whether it was rendering inside a bottom sheet container.
2. **Custom Local CSS Overrides**: Management pages defined local `<button class="btn-create">` styles with hardcoded `background: var(--uni-primary, #10b981)`. In dark mode, `--uni-primary` evaluates to `#5EEAD4` (mint), causing primary buttons to diverge from `UniButton.vue`'s dark teal background tokens.
3. **Lack of Single-Sheet Navigator**: There was no view-stack state manager within bottom sheets to handle sub-navigation (Root Filter View $\leftrightarrow$ Option Selection View).

---

## 3. Files Modified & Created

| Type | File Path | Changes Made |
| :--- | :--- | :--- |
| **New Component** | `src/components/ui/UniSheetNavigator.vue` | Reusable view-stack navigation manager for sheets with transitions, back button, selection list rendering, and auto-pop on option select |
| **Component Updated** | `src/components/ui/UniSelect.vue` | Added `presentation?: 'dropdown' \| 'embedded'`. In embedded mode, renders chevron forward `>` and delegates selection to parent navigator |
| **Component Updated** | `src/components/ui/UniFilterSheet.vue` | Integrated `UniSheetNavigator`. Displays `< Back` in sub-views, hides footer actions during selection, and handles `beforeClose` to pop subviews first |
| **Component Updated** | `src/components/ui/UniSheet.vue` | Added `beforeClose?: () => boolean` hook to allow child views to intercept dismissal and navigate back internally |
| **Component Updated** | `src/components/ui/UniButton.vue` | Scoped dark mode selectors with `:global(.dark)` and `:global(.ion-palette-dark)` to consistently apply `#0D9488` with `#FFFFFF` text |
| **Barrel Export** | `src/components/ui/index.ts` | Exported `UniSheetNavigator` |
| **View Updated** | `src/views/settings/SectionsPage.vue` | Configured embedded presentation for Year Level, Program, and Academic Year filters; replaced `.btn-create` with `UniButton` (`New`) |
| **View Updated** | `src/views/ReportsPage.vue` | Configured embedded presentation for Academic Period and Obligation Type filters |
| **View Updated** | `src/views/settings/AcademicYearsPage.vue` | Replaced `.btn-create` with `UniButton` (`New`) with accessible `aria-label` |
| **View Updated** | `src/views/settings/EventCategoriesPage.vue` | Replaced `.btn-create-category` with `UniButton` (`New`) with accessible `aria-label` |
| **View Updated** | `src/views/settings/SemestersPage.vue` | Replaced `.btn-create` with `UniButton` (`New`) with accessible `aria-label` |
| **View Updated** | `src/views/settings/YearLevelsPage.vue` | Replaced `.btn-create` with `UniButton` (`New`) with accessible `aria-label` |
| **View Updated** | `src/views/AcademicPage.vue` | Replaced `.btn-create` with `UniButton` (`New`) with accessible `aria-label` |
| **Test Suite** | `tests/unit/single-sheet-and-buttons.spec.ts` | Unit tests for `UniSheetNavigator`, `UniSelect` embedded mode, `UniFilterSheet` navigation, and button consistency |

---

## 4. Components Reused or Created

### `UniSheetNavigator.vue` (Created)
- **State**: `viewStack`, `currentView`, `currentTitle`, `canGoBack`, `activeSelectionMeta`.
- **Navigation**: `pushView(id, title, meta)`, `popView()`, `resetToRoot()`.
- **Built-in Selection View**: Automatically renders option list with checkmarks on selected item, option labels, optional badges, and auto-returns to root upon tap.
- **Context Injection**: Exposes `'uni-sheet-navigator'` context for nested child components.

### `UniFilterSheet.vue` (Extended)
- Now acts as a single-sheet container with internal view navigation.
- Root view displays filter avatar, title, active badge counter, form fields, and sticky footer (`[ Reset ]` and `[ Apply Filters ]`).
- Sub-view displays `< Back` button and option title in header; footer actions are hidden to dedicate full viewport to the scrollable option list.
- Intercepts Escape key and backdrop clicks via `beforeClose` to pop subviews back to root before closing the sheet.

### `UniSelect.vue` (Extended)
- Supports `presentation="embedded"` (and auto-detects when rendered inside a `UniSheetNavigator`).
- Renders as a row button with trailing chevron `>` (`chevronForwardOutline`).
- On tap, requests parent navigator to push selection view without creating secondary modals or backdrops.

### `UniButton.vue` (Standardized)
- `variant="primary"` guarantees dark teal background (`#0F766E` Light / `#0D9488` Dark) with white text (`#FFFFFF`) across all platforms.
- Eliminates bright mint button styling on management screens.

---

## 5. Minimal New Button Standardization
Management screen header buttons simplified to compact `+ New` while preserving descriptive accessibility labels:

| View | Button Label | Accessible Attribute | Component |
| :--- | :--- | :--- | :--- |
| `SectionsPage.vue` | `New` | `aria-label="Create new section"` | `UniButton variant="primary" size="sm" :icon="addOutline"` |
| `SemestersPage.vue` | `New` | `aria-label="Create new semester"` | `UniButton variant="primary" size="sm" :icon="addOutline"` |
| `AcademicYearsPage.vue` | `New` | `aria-label="Create new academic year"` | `UniButton variant="primary" size="sm" :icon="addOutline"` |
| `EventCategoriesPage.vue` | `New` | `aria-label="Create new event category"` | `UniButton variant="primary" size="sm" :icon="addOutline"` |
| `YearLevelsPage.vue` | `New` | `aria-label="Create new year level"` | `UniButton variant="primary" size="sm" :icon="addOutline"` |
| `AcademicPage.vue` | `New` | `aria-label="Create new semester term"` | `UniButton variant="primary" size="sm" :icon="addOutline"` |

---

## 6. Sequential Verification Results

| Step | Command | Exit Code | Result Summary |
| :--- | :--- | :--- | :--- |
| **1. Unit Tests** | `pnpm test:unit -- --run` | `0` | **PASS**: 19 test files passed, 112 tests passed (including 8 new tests in `single-sheet-and-buttons.spec.ts`) |
| **2. Linter** | `pnpm lint` | `0` | **PASS**: 0 lint errors, 0 warnings |
| **3. Build** | `pnpm build` | `0` | **PASS**: `vue-tsc && vite build` succeeded in 28.73s |
| **4. Cap Sync** | `pnpm exec cap sync android` | `0` | **PASS**: Assets copied to native Android project, 4 plugins synced |

---

## 7. Remaining Issues or Limitations
- Physical Android hardware touch gestures and haptic feedback timings were verified through unit testing and component contract tests, but not run on a connected physical Android device.

