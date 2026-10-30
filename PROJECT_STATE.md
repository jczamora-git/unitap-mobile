# Project State — UniTap

**Last Updated:** Full Application UI Regression Audit & Repair (v1.6.0)  
**Package ID:** `com.unitap.app` (Isolated installation alongside NFC Inspector)  
**Display Name:** UniTap (CSG Attendance & Student Management)  
**UI/UX Identity:** UniTap Custom Presentation System (Minimal Premium Mobile Experience)

---

## Environment & Tooling
- Node.js & npm: Node 20+, `npx pnpm`
- Framework: Ionic Vue 9 / Vue 3.5 / Capacitor 8
- Native Android Plugin: `@capgo/capacitor-nfc`, `@capacitor/haptics`, `@capacitor/preferences`
- Android SDK: `C:\Users\JC Zamora\AppData\Local\Android\Sdk`
- Android Build: Gradle 8.13.0, Android Gradle Plugin 8.1.1, Java 17

---

## Verification Summary
- **Unit Tests**: **25 of 25 PASSED** (`npm run test:unit -- --run`)
  - UI Component Regression Suite (UniButton variants/sizes/accessibility, UniPageHeader actions/titles/badges, UniDock 5-tab layout & aria-labels, UniDialog confirmation/cancel flows)
  - Student validation, duplicate rejection, card lifecycle, and `lookupCard` (active, inactive/replaced, unregistered)
  - Event audience filtering, occurrence lifecycle, pending-to-absent conversion
  - Attendance scoring (present, late grace cutoff), duplicate tap rejection
  - Finance centavo math, ledger balances, partial payments, multi-charge allocation, overpayment prevention
- **Linter**: **0 errors, 0 warnings**
- **TypeScript**: **0 errors** (`npx vue-tsc --noEmit`)
- **Web Build**: **Production bundle generated** (`npm run build`)
- **Android APK Build**: **SUCCESSFUL in 44s** (`android/app/build/outputs/apk/debug/app-debug.apk`)
- **GitHub Actions CI**: **SUCCESSFUL** (Run [#38458208509](https://github.com/jczamora-git/nfc-scan/actions/runs/38458208509))
- **Capacitor Sync**: **Clean sync** (all plugins registered)

---

## NFC Workflows Architecture
1. **NFC Checker (`NfcCheckerPage.vue` at `/tabs/scan`)**:
   - Read-only identity lookup tool for CSG personnel.
   - Detects physical NFC tag UIDs and looks up student registration via `studentService.lookupCard()`.
   - Distinct lifecycle presentations:
     - `ACTIVE`: displays registered student card, academic info, masked UID, and "View Student Profile".
     - `LOST` / `REPLACED` / `DEACTIVATED`: displays inactive card status notice with historical linked student info without reactivation.
     - `UNREGISTERED`: displays unlinked card feedback with detected UID and "Register Card" action.
   - Strictly read-only: never modifies wallet balance, attendance sessions, or student records.
2. **Attendance Scanner (`AttendanceScanPage.vue` at `/events/attendance/:occurrenceId?`)**:
   - Occurrence-specific check-in scanner under the Events workflow.
   - Verifies session status, eligibility, present/late cutoff, and records immutable attendance logs.
   - Shares native NFC service (`useNfc`) with coordinated view leave listener cleanup.

## Custom Presentation System Architecture (`src/components/ui/`)
- Bespoke semantic Vue 3 presentation layer replacing all generic Ionic UI controls.
- **Tokens (`src/theme/tokens.css`)**: Dark (`#111318` bg, `#1B1D22` surface, `#24272D` elevated, `#F5F6F7` text) and Light (`#F7F8FA` bg, `#FFFFFF` surface, `#F0F2F5` elevated). Brand accents: Aurora Mint (`#70F3CF`), Soft Blue (`#65BFFF`), Violet (`#8B85F6`).
- **Unified Header (`UniPageHeader.vue`)**: Consistent geometry across all 14 views.
- **Minimal Icon-Only Dock (`UniDock.vue` & `TabsPage.vue`)**: 5 equal navigation items, non-elevated Scan button, no labels, pill container.
- **Finance Grid Fix**: Zero horizontal overflow using `repeat(2, minmax(0, 1fr))` and `min-width: 0`.
- **Custom Sheets & Dialogs**: `UniSheet.vue` (bottom sheet with drag handle and backdrop dim) and `UniDialog.vue` (centered confirmation/destructive modal).
- **Custom Toasts (`UniToast.vue` & `useToast.ts`)**: Pill notification positioned above dock with deduplication and timer management.

---

## Design System Tokens & Foundations (UniTap Living Interface)
- **Living Interface Visual System**:
  - Dark Canvas: `#111318` | Dark Surface: `#1B1E24` | Elevated Dark: `#242831`
  - Light Canvas: `#F7F8FA` | Light Surface: `#FFFFFF`
  - Aurora Mint: `#70F3CF` | Aurora Sky: `#65BFFF` | Soft Violet: `#8B85F6` | Warm Peach: `#FFB78F`
- **Reusable Component Suite (`src/components/ui/`)**:
  - `PremiumButton.vue`: Standardized buttons with tactile `scale(0.98)` press feedback, loading indicators, and haptic response.
  - `PremiumCard.vue`: Physical tactile card surfaces (standard, hero, interactive, digital ID).
  - `PremiumSheet.vue`: Native-feeling bottom sheet with breakpoints, drag handle, and gesture dismissal.
  - `PremiumModal.vue`: Focused decision dialogs with backdrop blur and haptic confirmation.
  - `PremiumStatusBadge.vue`: Pill badges with animated live glowing pulse dots.
  - `PremiumEmptyState.vue`: Intentional empty states with contextual icons and direct actions.
  - `PremiumInput.vue`: High-craft text inputs with focus rings and inline validation.
- **Onboarding Experience (`src/components/onboarding/`)**:
  - 3-page interactive onboarding tour with custom illustrations, paginated progress dots, skip action, and Settings replay.
- **Haptic Feedback**:
  - `@capacitor/haptics` integration with light ticks on tabs/buttons and notification feedback on NFC operations.
- **Floating Pill Dock**: Elevated bottom navigation (~64px height, 28px border-radius, top-edge reflection, signature Aurora Mint center NFC button with glow).

---

## Modules Status Matrix

| Module | Status | Persistence Key / Mechanism | Notes |
|---|---|---|---|
| **Student Directory & Registration** | Complete | `nfc_inspector_students_v1` | Unique student numbers, compact 46px search, horizontal chips, refined directory rows. |
| **NFC Card Lifecycle Management** | Complete | Local Student Records | ACTIVE, LOST, REPLACED, DEACTIVATED states with collision rejection. |
| **CSG Event Management** | Complete | `unitap_events_v1` | Event CRUD, schedules, occurrences, 3-pill filter segment, active event mint strips. |
| **NFC Attendance Tracking** | Complete | `unitap_events_v1` + Native NFC | Live occurrence check-in, Present/Late grace period, duplicate rejection, luminous hero radar scanner. |
| **Session Finalization** | Complete | `unitap_events_v1` | Auto-converts pending students to Absent on session closure. |
| **Manual Attendance Correction** | Complete | `unitap_events_v1` | Officer override with mandatory reason & activity audit log. |
| **Student Charges & Templates** | Complete | `unitap_finance_v1` | Template library, manual issuance, integer centavo math. |
| **Simulated Student Wallet** | Complete | `unitap_finance_v1` | Premium Aurora balance card, top-up modal, ledger-based balance derivations. |
| **NFC-Assisted Payment** | Complete | `unitap_finance_v1` | 4-step payment flow, digital receipt card, partial & multi-charge allocations. |
| **Floating Dock Navigation & Home** | Complete | Ionic Vue Routing | Home (Aurora session card, 2x2 stat grid, quick actions), Events, Scan, Students, Finance. |
| **Onboarding & First Launch** | Complete | `unitap_onboarding_completed_v1` | 3-step tour with replay capability from Settings. |
| **Settings & Diagnostics** | Complete | `demo-data.service.ts` | Grouped iOS/fintech list rows, web-preview graceful detection, safe demo reset, onboarding replay. |
| **Hardware Diagnostics** | Complete | Diagnostic components | Preserved from original NFC Inspector. |
