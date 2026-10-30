# Changelog — UniTap

All notable changes to the UniTap application prototype will be documented in this file.

## [1.6.0] - 2026-10-14

### Fixed & Standardized — Full Application UI Regression Audit & Repair
- **Settings Gear & Header Action Icon System (Issue A)**:
  - Fixed root cause where `.settings-action-btn`, `.diagnostics-action-btn`, and trailing header buttons were unstyled native buttons with collapsing icon dimensions.
  - Standardized `.uni-header-action-btn` across all views with 40x40px touch targets, 11px border radius, subtle hover/pressed scaling, and 21px centered icons (`src/theme/custom.css` & `UniPageHeader.vue`).
- **Create Event Primary Button (Issue B)**:
  - Standardized the Home Attendance Session card action with `UniButton` (variant `primary`, size `md`, 46px height, Aurora Mint `#70F3CF` surface, readable dark foreground, and `addOutline` icon).
  - Enforced `min-height` constraints on `UniButton` size classes (`sm`: 36px, `md`: 46px, `lg`: 52px) preventing flex container collapsing.
- **Delete, Void, Clear & Deactivate Destructive Actions (Issue C)**:
  - Repaired student profile delete button (`StudentProfilePage.vue`), history purge button (`HistoryPage.vue`), and void fee button (`ChargesPage.vue`).
  - Added `.action-btn-danger` and `variant="destructive"` styling using restrained danger palettes (`#DC2626` / `#EF4444` in dark mode) without oversized solid red blocks.
  - Standardized `UniDialog.vue` to support prop aliasing (`confirmLabel` / `confirmText`, `cancelLabel` / `cancelText`, `@close` / `@cancel` events) ensuring all confirmation safeguards trigger properly.
- **Form Submissions & Modal Actions**:
  - Replaced unstyled or ad-hoc submit buttons in `CreateEventPage.vue`, `CreateChargePage.vue`, `MakePaymentPage.vue`, `StudentWalletPage.vue`, `AttendanceScanPage.vue`, and `ReplaceRfidModal.vue` with semantic `UniButton` components.
- **UI Component Regression Test Suite**:
  - Implemented unit regression tests in `tests/unit/ui-components.spec.ts` covering button variants, header action slots, dock tab count & accessibility labels, and dialog confirm/cancel interactions (25 total tests passing).

## [1.5.0] - 2026-10-14

### Added & Refined — NFC Checker & Mobile UI Refinement
- **NFC/RFID Checker as Default Scan Tab (`NfcCheckerPage.vue`)**:
  - Converted `/tabs/scan` into a dedicated, general-purpose read-only student card identity lookup tool.
  - Instantly checks whether scanned physical NFC card UIDs are registered in UniTap via `studentService.lookupCard()`.
  - Supports card lifecycle states: `ACTIVE` (displays full student information and profile link), `LOST`, `REPLACED`, `DEACTIVATED` (displays lifecycle status notice and linked student details without reactivation), and `UNREGISTERED` (displays card not registered with detected UID and "Register Card" action carrying UID).
  - Strictly read-only: does NOT record event attendance, deduct credits, or alter student records.
- **Event Attendance Scanning Preservation**:
  - Moved attendance scanning under the Events workflow at `/events/attendance/:occurrenceId?`.
  - Accessible directly from Home active session card and Event Details ("Scan NFC" button).
  - Preserved occurrence attendance recording, eligibility, duplicate detection, and present/late scoring.
- **Android Safe-Area & Double Header Padding Fix**:
  - Resolved double safe-area inset bug where `.safe-content` and `UniPageHeader.vue` both added status bar insets.
  - Compact header padding (`padding-top: calc(8px + var(--ion-safe-area-top))`, `padding-bottom: 8px`).
  - Aligned back button and trailing actions directly with the title row for consistent native baseline alignment.
- **Minimal Responsive Floating Dock**:
  - Configured 5-column CSS grid (`repeat(5, minmax(0, 1fr))`) with `min-width: 0` on every tab button.
  - Responsive down to 320px-360px screens with scaled icons and non-elevated Scan button.
- **Fixed Create Event Button**:
  - Replaced unstyled browser button in Home dashboard with shared `UniButton` component in Aurora Mint (`#70F3CF`).
- **Home Dashboard & Quick Actions Refinement**:
  - Replaced misleading "All offline records synchronized" text with accurate local operation messaging ("Ready for Event Sessions").
  - Cleaned up quick action labels (`Scan`, `New Event`, `Add Student`, `Pay Fee`) with 2-column fallback on narrow screens.
- **Refined Bottom Sheet (`UniSheet.vue`)**:
  - Refined 24px top radius, 36px drag handle and close button touch targets, compact header padding, and safe-area insets.

### Added — UniTap Custom UI Component Presentation System
- **Custom Presentation Architecture**:
  - Replaced generic Ionic UI visual presentation components (`IonButton`, `IonCard`, `IonInput`, `IonSelect`, `IonAlert`, `IonModal`, `IonHeader`) with custom Vue 3 semantic components (`Uni*`) in `src/components/ui/`.
  - Preserved Ionic routing infrastructure, `<ion-router-outlet>`, Capacitor container, and native NFC plugins.
- **Design Token System (`src/theme/tokens.css`)**:
  - Centralized semantic token architecture for Dark (`#111318` bg, `#1B1D22` surface, `#24272D` elevated, `#F5F6F7` text) and Light (`#F7F8FA` bg, `#FFFFFF` surface, `#F0F2F5` elevated) themes.
  - Brand accents: Aurora Mint (`#70F3CF`), Soft Blue (`#65BFFF`), Violet (`#8B85F6`), Amber (`#F59E0B`).
- **Unified Custom Page Header (`UniPageHeader.vue`)**:
  - Consistent layout across all 14 screens supporting title, subtitle, back navigation, badges, and trailing action slots.
  - Replaced all legacy `<ion-header>` and `<ion-toolbar>` instances across views.
- **Minimal Icon-Only Bottom Dock (`UniDock.vue` & `TabsPage.vue`)**:
  - 5 equal navigation destinations (Home, Events, Scan, Students, Finance).
  - All items have equal width, height, 22-24px icon stroke, and same vertical positioning.
  - Text labels removed; Scan button is non-elevated. Full floating pill container (`58px` height) with subtle Aurora Mint active state and accessible ARIA attributes.
- **Finance Screen Horizontal Overflow Bug Fix**:
  - Replaced fixed-width and default `minmax(auto, 1fr)` grids with `grid-template-columns: repeat(2, minmax(0, 1fr))` and `min-width: 0` on `UniActionCard.vue`.
  - Eliminated horizontal viewport overflow on narrow mobile screens (360px-390px).
- **Refined Form System & Register Student Redesign**:
  - Form suite: `UniFormField.vue`, `UniInput.vue`, `UniSelect.vue`, `UniTextarea.vue`, `UniSegmentedControl.vue`, `UniCheckbox.vue`, `UniButton.vue`.
  - Redesigned `RegisterStudentPage.vue` into single-column flow with compact segmented Year Level picker (1, 2, 3, 4) and compact interactive NFC card association.
- **Professional Custom Sheet (`UniSheet.vue`) & Decision Dialog (`UniDialog.vue`)**:
  - Custom Vue Teleport bottom sheet with drag handle, backdrop dimming, vertical slide transitions, safe maximum height (`88vh`), and body scroll lock.
  - Custom centered dialog modal for confirmation and destructive flows (replaced all native browser/Ionic `IonAlert` instances).
- **Custom Toast Notification System (`UniToast.vue` & `useToast.ts`)**:
  - Floating pill toast positioned above dock safe area (`calc(78px + safe-area)`).
  - Central reactive manager with deduplication and timer management.

## [1.3.0] - 2026-10-14

### Added — UniTap Living Interface System
- **Living Interface Tokens & Motion Engine**:
  - Semantic surface layers in `src/theme/variables.css` (`#111318` canvas, `#1B1E24` surface, `#242831` elevated, `#F7F8FA` light canvas, `#FFFFFF` light surface).
  - Signature Aurora accent suite: Aurora Mint (`#70F3CF`), Aurora Sky (`#65BFFF`), Soft Violet (`#8B85F6`), Warm Peach (`#FFB78F`).
  - Motion tokens in `src/theme/premium-motion.css` (`--motion-fast`, `--motion-standard`, `--motion-sheet`) with subtle spring curves (`cubic-bezier(0.16, 1, 0.3, 1)`) and `@media (prefers-reduced-motion)` support.
- **Component System Suite (`src/components/ui/`)**:
  - `PremiumButton.vue`: Standardized button variants with tactile press feedback, loading state, and haptic response.
  - `PremiumCard.vue`: Tactile physical card surfaces (`standard`, `hero`, `interactive`, `digital-id`).
  - `PremiumSheet.vue`: Native-feeling bottom sheet built with `ion-modal` sheet breakpoints `[0, 0.5, 0.92]`, compact drag handle, and gesture dismissal.
  - `PremiumModal.vue`: Focused decision dialog for confirmations and destructive actions.
  - `PremiumStatusBadge.vue`: Refined pill status badge with live glowing pulse dots.
  - `PremiumEmptyState.vue`: Intentional empty states with contextual icons and direct actions.
  - `PremiumInput.vue`: High-craft text inputs with subtle focus rings and inline validation messages.
- **Onboarding Experience**:
  - 3-page interactive onboarding tour (`OnboardingModal.vue`) covering Identity, Attendance, and Operations with animated SVG/CSS illustrations.
  - First-launch persistence (`unitap_onboarding_completed_v1`) via `@capacitor/preferences` with skip action and Settings replay.
- **Tactile Haptic Feedback**:
  - Integrated `@capacitor/haptics` utility (`src/utilities/haptics.ts`) for subtle tap ticks and scan success/duplicate notification responses with web-preview fallbacks.
- **Interactive Upgrades Across Screens**:
  - **Attendance Scanner**: Dynamic radar scanner with 3 wave rings and animated pulse core driven by actual NFC scan states.
  - **Home Dashboard**: Aurora Attendance Session card with tactile action routes.
  - **Finance Screen**: Bottom sheet integration for transaction and payment allocation breakdowns.
  - **Student Directory & Profile**: Tactile row feedback and digital student ID card.
  - **Events Screen**: Tactile segment filtering and active event mint accent strips.
- **Verification**:
  - ESLint: 0 errors, 0 warnings (`npx pnpm lint`).
  - TypeCheck: 0 errors (`npx vue-tsc --noEmit`).
  - Unit Tests: 14/14 passed (`npx pnpm test:unit -- --run`).
  - Production Web Build: Passed (`npx pnpm build`).
  - Capacitor Android Sync: Passed (`npx cap sync android`).
  - Android Debug APK: Successfully assembled (`android/app/build/outputs/apk/debug/app-debug.apk`, ~5.42 MB, Oct 14 2026 12:58 AM).

## [1.2.0] - 2026-10-14

### Upgraded — UniTap Premium Aurora Visual Architecture
- **Signature Aurora Gradient System**:
  - Created centralized gradient tokens and depth utilities in `src/theme/premium-aurora.css`: Aurora Primary (`#70F3CF`, `#65BFFF`, `#8B85F6`, `#FFB78F`), Aurora Cool, Aurora Warm, and Aurora Mint.
  - Implemented multi-layered surface lighting with subtle top-edge highlights (`border-top: 1px solid rgba(255, 255, 255, 0.22)`), internal glows (`inset 0 1px 0 rgba(255, 255, 255, 0.12)`), and abstract NFC wave watermarks.
  - Reusable component `PremiumAuroraCard.vue` (`src/components/PremiumAuroraCard.vue`) supporting variant gradients, light/dark text contrast, and action slots.
- **Deep Graphite Palette & Brand Accents**:
  - Updated `src/theme/variables.css` with deep graphite dark palette (`#111318` canvas, `#181B21` elevated, `#202329` surface, `#292D35` subtle) and refined light canvas (`#F6F8FB`).
  - Standardized Aurora Mint (`#70F3CF`) as the primary interactive accent across buttons, active tab indicators, and live session pills.
- **One Visual Focal Point Per Screen**:
  - **Home Dashboard**: Upgraded the active attendance session into an Aurora gradient hero card with custom gradient progress bar, status glow dot, and prominent NFC tap action. Added distinct luminous metric icon tags.
  - **Finance Screen**: Upgraded the financial overview into an Aurora digital wallet hero card with simulated ledger indicator, large tabular PHP amount, and NFC accent symbol.
  - **NFC Scanner**: Re-architected scanner surface into a concentric luminous radar console with 3 ripple rings (`.ring-1`, `.ring-2`, `.ring-3`) and animated pulse core tied to real scanner states.
  - **Student Profile**: Added compact digital student identity card (`.digital-id-card`) with simulated EMV chip styling, student details, and active NFC indicator.
  - **Events Screen**: Added thin mint accent strips (`.active-event-strip`) to active events while preserving clean neutral styling for completed activities.
  - **Floating Dock Navigation**: Elevated bottom dock with top-edge reflection, active mint icons, and signature Aurora Mint circular NFC button.
- **Verification**:
  - ESLint: 0 errors, 0 warnings (`npx pnpm lint`).
  - TypeCheck & Production Build: Passed (`npx pnpm build`).
  - Unit Tests: 14/14 passed (`npx pnpm test:unit -- --run`).
  - Android Debug APK: Successfully assembled (`android/app/build/outputs/apk/debug/app-debug.apk`, ~5.4 MB, Oct 14 2026 12:43 AM).

---

## [1.1.0] - 2026-10-14

### Redesigned — UniTap Minimal UI/UX
- **Design System Tokens & Typography**:
  - Implemented centralized semantic color system (`--app-bg-canvas: #F7F8FA`, `--app-surface-primary: #FFFFFF`, `--app-surface-secondary: #F0F2F5`, `--app-accent-primary: #3B82F6`, `--app-border-color: #E8EBEF`).
  - Switched font family to Inter with native system fallbacks; implemented disciplined typography scale.
  - Applied `.tabular-nums` and monospace styling to all financial and statistical figures.
- **Floating Pill Bottom Navigation**:
  - Re-architected 5-tab bar into a modern floating dock (~64px height, 28px rounded corners, subtle shadow and border).
- **Home Dashboard & Primary Screens**:
  - Minimal headers, 2x2 metric grid, clean event cards, compact 46px search field, horizontal scrollable filter chips.
- **Verification**:
  - All unit tests and builds verified.

---

## [1.0.0] - 2026-10-13

### Added
- **UniTap Rebranding**: Rebranded user-facing application name to "UniTap" with subtitle "CSG Attendance & Student Management". Preserved application package ID `com.nfcinspector.app`.
- **Domain Models & Repositories**: Student directory, NFC card lifecycle, CSG events, attendance rules, and simulated wallet ledger.
