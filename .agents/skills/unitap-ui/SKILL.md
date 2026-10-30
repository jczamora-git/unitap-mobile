---
name: unitap-ui
description: UI/UX standards, custom presentation layer, design system tokens, and mobile-friendly styling for UniTap.
---

# UniTap UI Skill — Custom Component Presentation System

## 1. Architecture: Custom Presentation Layer
UniTap replaces generic Ionic UI presentation controls with bespoke Vue 3 semantic components while preserving Ionic routing and mobile container capabilities:
- **Presentation Layer**: Custom components in `src/components/ui/` (`Uni*`).
- **Semantic HTML**: Accessible native `<button>`, `<input>`, `<select>`, `<dialog>`, and flexbox/grid containers.
- **Preserved**: `<ion-page>`, `<ion-content>`, `<ion-router-outlet>`, and Ionic Vue Router navigation.

## 2. Design Tokens (`src/theme/tokens.css`)
Centralized semantic token system for Dark and Light themes:
- **Dark Theme**:
  - Background: `#111318`
  - Surface: `#1B1D22`
  - Elevated Surface: `#24272D`
  - Primary Text: `#F5F6F7`
  - Secondary Text: `#949BA6`
  - Border: `rgba(255, 255, 255, 0.07)`
- **Light Theme**:
  - Background: `#F7F8FA`
  - Surface: `#FFFFFF`
  - Elevated Surface: `#F0F2F5`
  - Primary Text: `#191B20`
  - Secondary Text: `#747B85`
  - Border: `rgba(0, 0, 0, 0.06)`
- **Brand Accent**: Aurora Mint (`#70F3CF`)
- **Supporting Accents**: Soft Blue (`#65BFFF`), Violet (`#8B85F6`), Amber (`#F59E0B`), Coral (`#FF6B6B`).

## 3. Component System Architecture (`src/components/ui/`)
- `UniPageHeader.vue`: Unified header supporting root, detail (back button), optional subtitles, badges, and trailing action slots.
- `UniButton.vue`: Semantic `<button>` with tactile press (`scale(0.975)`), loading spinner, variants (`primary`, `secondary`, `outline`, `ghost`, `destructive`), and haptic integration.
- `UniCard.vue`: Standard clean surface container with 18px radius and subtle borders.
- `UniHeroCard.vue`: Focal Aurora multi-stop gradient card with top-edge reflection.
- `UniStatCard.vue`: Compact statistic tile with label, tabular numerals, and icon pill.
- `UniActionCard.vue`: Grid-safe action tile with `min-width: 0` and flex shrink safety.
- `UniFormField.vue`: Wrapper for labels, required markers, hints, and errors.
- `UniInput.vue`: High-craft input (48px height, 13px radius, focus ring, leading icon, monospace option).
- `UniSelect.vue`: Accessible native select with custom dropdown chevron.
- `UniTextarea.vue`: Form-consistent textarea.
- `UniSegmentedControl.vue`: Pill segmented controller for filter tabs and options.
- `UniCheckbox.vue`: Semantic custom checkbox.
- `UniSheet.vue`: Custom bottom sheet with Vue `<Teleport>`, drag handle, backdrop dim, vertical slide, body scroll lock, and ESC/backdrop dismissal.
- `UniDialog.vue`: Custom decision modal with Vue `<Teleport>`, icon, title, description, and cancel/confirm buttons.
- `UniToast.vue`: Floating toast notification with smooth translate transition.
- `UniStatusBadge.vue`: Pill badge with optional live pulsing dot.
- `UniEmptyState.vue`: Refined empty state container with icon and call-to-action button.

## 4. Minimal Icon-Only Dock (`src/views/TabsPage.vue` & `src/components/navigation/UniDock.vue`)
- 5 equal navigation destinations: Home, Events, Scan, Students, Finance.
- Equal width, equal height, consistent 22-24px icon stroke, and same vertical positioning.
- **No text labels**. **Scan is not elevated** (same physical dimensions as every other tab).
- Minimal floating pill: full pill radius, `58px` height, floating above safe area.
- Subtle Aurora Mint active pill indicator with accessible `aria-label` tags.

## 5. Sheet & Dialog Standards
- **Sheets (`UniSheet.vue`)**:
  - Top corner radius: 24px.
  - Centered thin drag handle.
  - Teleports to `body`, traps focus, restores focus, locks body scroll, and handles Android back button / ESC.
  - Max height capped at `88vh` to prevent viewport overflow.
- **Dialogs (`UniDialog.vue`)**:
  - Centered surface with 20px radius.
  - Restrained destructive states.
  - Order: Cancel first, Confirm second.

## 6. Toast Behavior (`src/composables/useToast.ts`)
- Central reactive manager (`toastState`).
- Floats at `bottom: calc(78px + env(safe-area-inset-bottom))` — never obscures the bottom dock.
- Automatic deduplication and timer replacement to prevent toast flooding.

## 7. Responsive Layout & Overflow Rules
- Standard horizontal padding: `20px` (or `16px` on narrow devices down to 320px).
- Grid layout: `grid-template-columns: repeat(2, minmax(0, 1fr))` with `min-width: 0` on children to eliminate horizontal overflow on narrow screens.
- Dock layout: `display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); width: calc(100% - 24px); max-width: 420px;` with 20px icons on narrow screens (<360px).
- No `100vw` inside padded parents.

## 8. Safe-Area & Header Hierarchy
- **Single Top-Safe-Area Inset**: Handled solely by `UniPageHeader.vue` (`padding-top: calc(8px + var(--ion-safe-area-top))`).
- **Content Scroll Area**: `.safe-content` applies static `--padding-top: 12px;` so status bar insets are never doubled.
- **Header Alignment**: Back button (38px target) and trailing action slots align directly with the title row for consistent baseline geometry. Subtitles flow beneath.

## 9. Component Contract & Regression Safeguards
- **Header Actions (`.uni-header-action-btn`)**:
  - Touch target: Minimum 40x40px.
  - Border radius: 11px.
  - Icon size: 21x21px centered.
  - Variant `.action-btn-danger`: Restrained danger surface (`rgba(220,75,75,0.08)`) and border (`rgba(220,75,75,0.22)`).
- **Buttons (`UniButton.vue`)**:
  - Sizes: `sm` (36px min-height), `md` (46px min-height), `lg` (52px min-height), `icon` (40x40px), `icon-sm` (36x36px).
  - Enforced `min-height` and `box-sizing: border-box` to prevent flex container collapsing.
  - Props: `variant` (`primary` | `secondary` | `outline` | `ghost` | `destructive`), `block`, `loading`, `disabled`, `icon`, `iconOnly`, `ariaLabel`.
- **Destructive Operations & Safeguards**:
  - Always require double-action confirmation via `UniDialog.vue`.
  - Prop aliases supported: `confirmText` / `confirmLabel`, `cancelText` / `cancelLabel`.
  - Restrained crimson accents (`#DC2626` light / `#EF4444` dark). Never use full-width solid red blocks.

