# UniTap 2.0 — Hybrid Online-Offline NFC CSG Operations, Attendance & Financial Platform

**UniTap 2.0** is an enterprise-grade hybrid mobile application built with **Ionic Vue 9**, **Capacitor 8**, **TypeScript**, and **Supabase** for Android. Designed for university Computer Studies Government (CSG) organizations, UniTap transforms university-issued student RFID/NFC cards into instant, tap-to-record attendance tokens and student account identifiers, powered by a native **34-table SQLite local database** and **bidirectional real-time cloud sync with Supabase PostgreSQL & Auth**.

---

## What's New in UniTap 2.0

### 1. Hybrid Online–Offline Architecture & Supabase Integration
- **Central Cloud Authority**: Supabase PostgreSQL serves as the authoritative central repository for user identities, profiles, card ownership, events, attendance, and financial ledgers.
- **Supabase Auth**: Online authentication, token refresh, and student self-registration via single-use 8-character activation tokens.
- **First-Login Hydration**: Downloads role-scoped authoritative records into SQLite (`InitialSyncService`) in foreign-key safe topological order.
- **Offline Operation**: Core operations (NFC scanning, photo verification, attendance, fines, contributions, wallet payments) read and write to local SQLite. Disconnected sessions remain valid for 7 days via cached tokens.
- **Bidirectional Sync**: Local mutations transactionally enqueue into `sync_outbox` and push to Supabase; remote mutations pull incrementally via monotonic cursors and Supabase Realtime channel notifications.

### 2. 34-Table Offline SQLite Database Architecture
- **Primary Persistence**: Operates reliably without internet connectivity using a SQLite schema with 34 tables, foreign keys (`PRAGMA foreign_keys = ON`), constraints, indexes, and transactional rollbacks.
- **Dual Adapter Architecture**: Web/Vitest WebAssembly adapter (`sql.js`) and Capacitor native adapter.
- **Transactional Legacy Migration**: Automatically migrates existing student, event, and finance records from Capacitor Preferences (`nfc_inspector_students_v1`, `unitap_events_v1`, `unitap_finance_v1`) into SQLite without data loss.

### 2. Offline Authentication & Role-Based Access Control
- **Argon2id Password Hashing**: Offline password hashing and verification using `hash-wasm`.
- **Three Distinct Roles**:
  - `DEVADMIN`: Full system administration, academic term management, system auditing.
  - `OFFICER`: Attendance scanning, identity verification, student roster import, card registration, financial collections.
  - `STUDENT`: Self-service view of personal profile, ID photo, enrollment, attendance history, and fee obligations.
- **Secure Student Self-Registration**: Activates using officer-issued 8-character single-use activation codes.

### 3. Academic Year & Semester Lifecycle
- **Multi-Semester History**: Manages academic years and semesters (`FIRST`, `SECOND`, `SUMMER`).
- **Single Active Semester Constraint**: Enforced at the database level via a partial unique index (`only_one_active_semester`).
- **Student Enrollments**: Preserves historical enrollment snapshots per semester.

### 4. CSV Student Roster Import Wizard
- **6-Column Standard**: Expects `school_id,first_name,middle_name,lastname,year,section`.
- **Security & Validation**: Formula injection sanitization (protecting against `=`, `+`, `-`, `@`), duplicate detection, and batch transaction logging.

### 5. Two-Step NFC Attendance & Photo Identity Verification
- **Photo Identity Verification**: NFC tap loads student credentials and local ID photo without immediately recording attendance.
- **Officer Confirmation**: Officer verifies the student's physical identity and taps **Confirm Student** (`PRESENT` or `LATE`) or **Reject - Wrong Person**.
- **Audit Logging**: Logs every tap in `attendance_attempts` (`SUCCESS`, `REJECTED`, `DUPLICATE`, `UNREGISTERED`).
- **Attendance Voiding**: Allows authorized voiding with a mandatory audit reason.
- **Session Ownership**: Prevents cross-screen NFC scan leakage.

### 6. Fines, Contributions & Double-Entry Ledger
- **Strict Centavo Precision**: Stored and calculated in integer Philippine centavos (₱100.00 = 10000).
- **Separation of Obligations**: Distinguishes disciplinary `FINE` from organizational `CONTRIBUTION`.
- **Simulated Wallet & Double-Entry Ledger**: Top-ups and payments are tracked through immutable ledger entries.
- **Payment Reversals**: Allows reversing payments with a mandatory reason, automatically refunding the simulated wallet ledger.

### 7. Offline Reporting & Printable Statements
- **Financial Summaries**: Computes total assessments, collections, and outstanding balances.
- **Export Formats**: One-click offline CSV export and printable HTML statement generation.

---

## Technology Stack

* **Framework**: [Ionic Framework 9](https://ionicframework.com/) (Vue 3 Composition API with `<script setup lang="ts">`)
* **Language**: TypeScript (Strict typing, zero errors)
* **Native Runtime**: [Capacitor 8](https://capacitorjs.com/)
* **Database**: SQLite (34 tables, `sql.js` in development, Capacitor SQLite on native Android)
* **Cryptography**: Argon2id via `hash-wasm`
* **NFC Plugin**: `@capgo/capacitor-nfc`
* **Testing & Tooling**: Vitest 4, Vue-TSC, Vite 8, pnpm
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
