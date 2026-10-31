# UniTap 2.0 Database Architecture Audit
**Date**: October 2026  
**Auditor**: UniTap Systems Architecture & Security Team  
**Scope**: UniTap 2.0 Hybrid Architecture (PostgreSQL / Supabase & SQLite)

---

## 1. Executive Summary

UniTap 2.0 is designed as a **hybrid online–offline mobile application**:
- **Supabase (PostgreSQL & Supabase Auth)** serves as the authoritative central cloud repository, managing identity, server-side authorization, immutable audit logs, durable operation receipts, and the monotonic change log.
- **SQLite** operates as the local device working database on Android, hosting cached authorized records, facilitating instantaneous offline operations (NFC attendance scanning, photo verification, obligation review), and buffering local mutations inside a transactional `sync_outbox`.

This audit assesses the 34 tables originally proposed in `01_unitap_offline_schema.sql`, analyzes differences between SQLite 3 and PostgreSQL (Supabase), classifies each table into its architectural tier, and addresses critical foreign-key, concurrency, and security considerations.

---

## 2. Table-by-Table Architectural Tier Classification

| Table Name | Tier | Primary Role & Sync Responsibility |
| :--- | :---: | :--- |
| `schema_migrations` | **SQLite Only** | Manages local SQLite migration versions independently from cloud migrations. |
| `academic_years` | **Both (Sync)** | Master academic calendars; synced down to all devices. |
| `semesters` | **Both (Sync)** | Terms and active status (`only_one_active_semester`). |
| `programs` | **Both (Sync)** | Curricular programs (e.g. BSIT). |
| `students` | **Both (Sync)** | Core student profiles (School ID, names, photo URLs). |
| `student_enrollments` | **Both (Sync)** | Point-in-time term snapshots (year level, section). |
| `profile_confirmations` | **Both (Sync)** | Semester student profile verification requests & submissions. |
| `users` | **Both (Sync)** | Application user accounts mapped 1:1 with Supabase `auth.users(id)`. |
| `user_credentials` | **Supabase Auth** | **CRITICAL CORRECTION**: Passwords managed by Supabase Auth (`auth.users`). Not stored in SQLite. |
| `user_roles` | **Both (Sync)** | DevAdmin, Officer, Student role assignments. Server authoritative. |
| `devices` | **Both (Sync)** | Registered mobile devices authorized for offline operations. |
| `user_device_access` | **SQLite Only** | Local device login rate limits, local lockout tracking, cached session expiry. |
| `activation_claims` | **Both (Sync)** | Single-use activation codes for student onboarding. Server verified. |
| `nfc_cards` | **Both (Sync)** | NFC tag mappings with unique active card constraints. |
| `events` | **Both (Sync)** | CSG general assemblies, sportsfests, seminars, cleanups. |
| `event_occurrences` | **Both (Sync)** | Specific check-in sessions with date, grace minutes, and status. |
| `event_participants` | **Both (Sync)** | Expected attendee rosters per session. |
| `attendance_records` | **Both (Sync)** | Confirmed attendances (`PRESENT`, `LATE`, `ABSENT`). |
| `attendance_attempts` | **Both (Sync)** | Audit logs of all card scans, including fraud rejections (`REJECTED`). |
| `attendance_audit` | **Both (Sync)** | Audit trails for officer overrides and attendance voids. |
| `obligation_rules` | **Both (Sync)** | Configurable fee templates (`FINE`, `CONTRIBUTION`) with centavo rates. |
| `student_obligations` | **Both (Sync)** | Assessed charges per student and semester. |
| `obligation_adjustments` | **Both (Sync)** | Authorized fee waivers, discounts, or penalties. |
| `payments` | **Both (Sync)** | Recorded payment transactions with idempotency keys. |
| `payment_allocations` | **Both (Sync)** | Breakdown mapping payments to specific obligations. |
| `simulated_wallets` | **Both (Sync)** | Student wallet accounts. |
| `simulated_wallet_ledger` | **Both (Sync)** | Immutable double-entry ledger (`TOP_UP`, `PAYMENT`, `PAYMENT_REVERSAL`). |
| `import_batches` | **SQLite Only** | Local staging batches for CSV roster imports before batch sync. |
| `import_rows` | **SQLite Only** | Line-by-line staging and error tracking for client imports. |
| `report_exports` | **SQLite Only** | Device logs of generated CSV / PDF files. |
| `audit_events` | **Both (Sync)** | High-level system actions for compliance and forensics. |
| `sync_outbox` | **SQLite Only** | Transactional FIFO queue of unpushed local mutations. |
| `sync_state` | **SQLite Only** | Local cursors, snapshot watermarks, and sync timestamps. |
| `sync_conflicts` | **Both (Sync)** | Concurrency collision logs with resolutions. |
| `sync_change_log` | **Supabase Only** | Monotonic append-only server change log powering delta pull sync. |
| `storage.objects` | **Supabase Only** | Private bucket `student-photos` storing student ID photographs. |

---

## 3. PostgreSQL vs. SQLite Schema Differences

| Feature | SQLite 3 Implementation | PostgreSQL / Supabase Equivalent |
| :--- | :--- | :--- |
| **UUIDs** | Stored as `TEXT` | Native `UUID` type with `gen_random_uuid()` |
| **Timestamps** | UTC ISO-8601 strings (`TEXT`) | `TIMESTAMPTZ` with timezone awareness |
| **Currency** | `INTEGER` centavos | `BIGINT` centavos with `CHECK (amount_centavos >= 0)` |
| **JSON Fields** | `TEXT` validated with `json_valid()` | Native `JSONB` with indexable operators (`@>`) |
| **Booleans** | `INTEGER` (`0` or `1`) | Native `BOOLEAN` (`TRUE` or `FALSE`) |
| **Date Only** | `TEXT` (`YYYY-MM-DD`) | Native `DATE` |
| **Foreign Keys** | `PRAGMA foreign_keys = ON;` | Enforced by default with constraint cascades |
| **Partial Indexes**| `CREATE UNIQUE INDEX ... WHERE status = 'ACTIVE'` | Fully supported in PostgreSQL with identical syntax |

---

## 4. Key Security & Architecture Findings

1. **Supabase Auth as Identity Authority**:
   - In pure offline designs, passwords were held locally in `user_credentials`.
   - In UniTap 2.0's hybrid model, `user_credentials` is removed from SQLite. Supabase Auth manages encrypted credentials on the server.
   - For returning users offline, the app stores a cryptographic token hash and encrypted session ticket with a bounded offline expiration (e.g. 7 days).
2. **Preventing School ID Harvesting**:
   - Students register using their School ID and a secure 8-character single-use activation code.
   - The activation claim is validated against Supabase via a secure RPC (`verify_and_claim_student_code`) before revealing student name or creating the `auth.users` profile.
3. **Double-Entry Wallet Concurrency**:
   - Because wallet balances are calculated from `simulated_wallet_ledger`, offline top-ups or payments must use unique idempotency keys (`idempotency_key`).
   - Server-side settlement prevents overspending across multiple disconnected officer devices.
4. **Photo Storage Security**:
   - Student ID photos must not be stored as blobs in SQLite or public web buckets.
   - Remote: Stored in private Supabase Storage bucket `student-photos` protected by RLS.
   - Local: Downloaded during initial sync into app-private file storage (`file:///data/user/0/com.unitap.app/files/photos/...`) with file path references stored in SQLite.

---

## 5. Migration Strategy

1. Deploy PostgreSQL schema and RLS policies to Supabase.
2. Maintain local SQLite repository compatibility using `database.ts` and versioned migrations.
3. Transactional Outbox ensures all local mutations write to `sync_outbox` in the same SQLite transaction as the business operation.
4. Push and Pull synchronization protocols guarantee data eventual consistency without blocking UI interactions.

