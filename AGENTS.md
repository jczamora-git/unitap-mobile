# AGENTS.md — UniTap Agent Development Guide

## Project Mission
UniTap is an offline-first NFC-powered Android application built with Ionic Vue for Computer Studies Government (CSG) attendance tracking, event management, and student financial obligations.

## Technology Stack
- **Framework**: Ionic Vue 9 (@ionic/vue, @ionic/vue-router)
- **Frontend Core**: Vue 3 (Composition API `<script setup lang="ts">`), TypeScript
- **Mobile Container**: Capacitor 8 (Android)
- **NFC Plugin**: `@capgo/capacitor-nfc`
- **Persistence**: `@capacitor/preferences` (Offline-first local repositories)
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
├── router/              # Ionic Vue Router configuration
├── services/            # Domain services (NFC, Student, Event, Attendance, Finance)
├── storage/             # Local repository abstractions & Preferences adapters
├── theme/               # Core styling tokens and CSS variables
├── types/               # TypeScript domain interfaces
├── utilities/           # Pure formatting, calculations, and normalizers
└── views/               # Primary Ionic Page views (IonPage, IonContent)
```

## Architectural Rules
1. **Separation of Concerns**: Never embed raw persistence or business logic in Vue components. Use domain services (`attendance.service.ts`, `finance.service.ts`, etc.) and repository abstractions.
2. **NFC Preservation**: Protect the working native NFC scanner (`nfc.service.ts`). Reuse its listener management; never create competing native listeners.
3. **Integer Centavos**: Internal currency values MUST be integer centavos (₱100.00 = 10000). Never calculate balances with floating-point numbers.
4. **Idempotence & Ledger**: The student wallet balance is computed from immutable ledger transactions (`TOP_UP`, `PAYMENT`, `ADJUSTMENT`), never stored as a mutable float.
5. **No Cloud Backend**: Prototype runs purely offline using `@capacitor/preferences`.
6. **Preserve Legacy Data**: Retain storage key `nfc_inspector_students_v1`. Backward-compatible reads for existing student records.
7. **Native Package ID**: `com.unitap.app` in `capacitor.config.ts` and `AndroidManifest.xml` (isolated from legacy NFC Inspector).
