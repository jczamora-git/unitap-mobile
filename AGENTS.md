# AGENTS.md — UniTap Agent Development Guide

## Project Mission
UniTap is an offline-first NFC-powered Android application built with Ionic Vue for Computer Studies Government (CSG) attendance tracking, event management, and student financial obligations.

## Technology Stack
- **Framework**: Ionic Vue 9 (@ionic/vue, @ionic/vue-router)
- **Frontend Core**: Vue 3 (Composition API `<script setup lang="ts">`), TypeScript
- **Mobile Container**: Capacitor 8 (Android)
- **Database**: SQLite (34 tables, WebAssembly `sql.js` in development & Vitest, Capacitor Native SQLite on Android)
- **Cryptography**: Argon2id via `hash-wasm`
- **NFC Plugin**: `@capgo/capacitor-nfc`
- **Persistence**: SQLite (Primary local database) & `@capacitor/preferences` (Lightweight non-sensitive settings)
- **Build / Tooling**: Vite 8, Vue-TSC, Vitest, pnpm

## Source Code Structure
```
src/
├── components/          # Reusable UI & modal components
│   ├── attendance/      # Attendance scan & session widgets
│   ├── events/          # Event & occurrence cards
│   ├── finance/         # Wallet, charges, transaction widgets
│   └── shared/          # Shared badges, sheets, formatters
├── composables/         # Vue composition helpers (useNfc, useStudents, useEvents, etc.)
├── database/            # SQLite engine, migrations, adapters, repositories
│   ├── adapters/        # Database adapters (web-dev and native-sqlite)
│   ├── migrations/      # 001_initial.sql / 001_initial.ts
│   └── repositories/    # Typed SQLite repositories (academic, auth, attendance, finance, etc.)
├── router/              # Ionic Vue Router configuration with auth route guards
├── services/            # Domain services (NFC, Student, Event, Attendance, Finance, Auth, CSV Import, Reports)
├── storage/             # Legacy storage abstractions & Preferences adapters
├── theme/               # Core styling tokens and CSS variables
├── types/               # TypeScript domain interfaces & database row models
├── utilities/           # Pure formatting, calculations, and normalizers
└── views/               # Primary Ionic Page views (IonPage, IonContent)
```

## Architectural Rules
1. **Separation of Concerns**: Never embed raw persistence or business logic in Vue components. Use domain services (`attendance.service.ts`, `finance.service.ts`, `auth.service.ts`, etc.) and repository abstractions.
2. **NFC Preservation**: Protect the working native NFC scanner (`nfc.service.ts`). Reuse its listener management; never create competing native listeners. Enforce single-screen session ownership.
3. **Integer Centavos**: Internal currency values MUST be integer centavos (₱100.00 = 10000). Never calculate balances with floating-point numbers.
4. **Idempotence & Ledger**: The student wallet balance is computed from immutable ledger transactions (`TOP_UP`, `PAYMENT`, `PAYMENT_REVERSAL`), never stored as a mutable float.
5. **Hybrid Online-Offline Architecture**: Supabase Auth & PostgreSQL serves as the authoritative central cloud repository; SQLite is the persistent local working database on Android. First login/registration requires internet connectivity to hydrate local tables. Core operations run directly against SQLite and enqueue into `sync_outbox`. Bidirectional push/pull sync runs automatically when online. Disconnected sessions remain valid for 7 days via cached tokens.
6. **Preserve Legacy Data**: Retain storage key `nfc_inspector_students_v1`. Backward-compatible reads and transactional migration to SQLite.
7. **Native Package ID**: `com.unitap.app` in `capacitor.config.ts` and `AndroidManifest.xml` (isolated from legacy NFC Inspector).
