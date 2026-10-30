# UniTap — NFC-Powered CSG Attendance, Event Management & Student Transactions

**UniTap** is an offline-first mobile application built with **Ionic Vue 9**, **Capacitor 8**, and **TypeScript** for Android. Designed for university student government organizations (CSG), UniTap transforms university-issued student RFID/NFC cards into instant, tap-to-record attendance tokens and student account identifiers.

---

## Key Modules & Features

### 1. Unified Dashboard (Home)
- **Real-Time CSG Metrics**: Registered student count, active events, check-in totals, and outstanding fee obligations.
- **Active Session Progress**: Live progress bar showing check-in percentage for ongoing events.
- **Quick Actions**: One-tap access to attendance scanning, event creation, student registration, and fee issuance.
- **Recent Activity Feed**: Real-time event log tracking check-ins, registrations, and transactions.

### 2. CSG Event & Attendance Management
- **Event Creation**: Schedule events (General Assembly, IT Day, Sportsfest, Seminars) with flexible audience rules (All BSIT, by Year Level, or by Section).
- **Session Lifecycle**: Open, monitor, and close attendance occurrences.
- **Live NFC Attendance Scanning**:
  - Automatically identifies registered students on tap.
  - Distinguishes **Present** from **Late** using a configurable grace period.
  - Rejects duplicate check-ins for the same occurrence.
  - Alerts when an unregistered card or ineligible student taps.
- **Session Finalization**: Automatically converts all remaining `PENDING` expected participants to `ABSENT` upon session closure.
- **Attendance Roster & Manual Corrections**: Review complete rosters with officer excuse overrides requiring an audit reason.

### 3. Student Information System & Card Lifecycle
- **Student Directory**: Student numbers, full names, year levels, sections, courses, and card statuses.
- **NFC Card Lifecycle**: Tracks `ACTIVE`, `LOST`, `REPLACED`, and `DEACTIVATED` card states while preserving card history.
- **Duplicate Protection**: Prevents assigning an active card to multiple students.
- **360° Student Profile**: View academic info, NFC card status, event attendance history, outstanding charges, and wallet balance.

### 4. Student Obligations & Simulated Wallet
- **Charge Templates & Issuance**: Create pre-set or custom fees (e.g., Clean-up Absence ₱20, Sportsfest Contribution ₱25) stored accurately in integer centavos.
- **Simulated Student Wallet**: Double-entry ledger architecture with demo top-up funds. Clearly labeled as simulated.
- **NFC-Assisted Payment Flow**: Tap student ID to load outstanding charges, select full or partial payments, and confirm settlement with unique receipt references.

### 5. Diagnostics & Sample Data
- **Hardware Diagnostics**: Low-level NFC tag inspection, UID stability testing, and raw scan logs preserved from NFC Inspector.
- **One-Tap Demo Seeding**: Idempotent sample data generation in Settings for seamless capstone presentation.

---

## Technology Stack

* **Framework**: [Ionic Framework 9](https://ionicframework.com/) (Vue 3 Composition API with `<script setup lang="ts">`)
* **Language**: TypeScript (Strict typing, zero errors)
* **Native Runtime**: [Capacitor 8](https://capacitorjs.com/)
* **NFC Plugin**: `@capgo/capacitor-nfc`
* **Storage**: `@capacitor/preferences` (Offline-first local persistence)
* **Target Platform**: Android (API 24+)
* **Package ID**: `com.nfcinspector.app`

---

## Capstone Demonstration Guide

For detailed step-by-step instructions on presenting the complete end-to-end flow during an academic capstone defense, see [DEMO_GUIDE.md](file:///c:/Users/JC%20Zamora/Downloads/nfc-scan/DEMO_GUIDE.md).

---

## Development & Testing

### Local Browser Preview
```bash
npx pnpm install
npx pnpm dev
```

### Unit Tests
```bash
npx pnpm test:unit -- --run
```
*(All 14 unit tests pass covering student validation, event lifecycle, NFC attendance rules, duplicate prevention, and financial ledger invariants.)*

### Lint & Typecheck
```bash
npx pnpm lint
npx vue-tsc --noEmit
```

### Production Build & Capacitor Sync
```bash
npx pnpm build
npx cap sync android
```

### Build Android Debug APK
```bash
cd android
./gradlew assembleDebug
```
Output APK location:
`android/app/build/outputs/apk/debug/app-debug.apk`
