# UniTap 2.0 First-Login Data Hydration Protocol

## 1. Overview

When a user logs into UniTap 2.0 on a freshly installed device, the application must hydrate its local SQLite database with authorized data from Supabase before enabling operational features.

---

## 2. State Machine

The hydration process transitions through these explicit states:

```text
[NOT_INITIALIZED]
       │
       ▼ (First Login Success)
 [DOWNLOADING] ──► (Network Interrupted) ──► [RESUMABLE] / [FAILED]
       │                                           │
       ▼ (All Batches Received)                    ▼ (Retry Sync)
  [VERIFYING]                                [DOWNLOADING]
       │
       ▼ (Foreign Keys & Checksums Valid)
    [READY]
```

- **`NOT_INITIALIZED`**: SQLite database has schema tables initialized, but no business data downloaded.
- **`DOWNLOADING`**: Active paginated download of authorized tables in dependency order.
- **`VERIFYING`**: Verifies record counts, foreign key integrity (`PRAGMA foreign_key_check`), and stores the watermark.
- **`READY`**: Hydration complete; enables dashboard and offline mode.
- **`RESUMABLE`**: Preserves staged records if network drops midway; resumes from last committed page.
- **`FAILED`**: Critical integrity failure; logs error and provides user retry action.

---

## 3. Hydration Order (Foreign-Key Dependency Safe)

To prevent foreign key violations, tables are downloaded and inserted in exact topological dependency order:

1. `academic_years`
2. `semesters`
3. `programs`
4. `obligation_rules`
5. `students`
6. `student_enrollments`
7. `nfc_cards`
8. `events`
9. `event_occurrences`
10. `event_participants`
11. `attendance_records`
12. `student_obligations`
13. `payments`
14. `payment_allocations`
15. `simulated_wallets`
16. `simulated_wallet_ledger`

---

## 4. Role-Specific Data Scoping

- **DEVADMIN**:
  - Full academic definitions, system settings, programs, active events.
  - Large datasets (complete student body) paginated on demand.
- **OFFICER**:
  - All active semester students, enrollments, and active NFC card mappings.
  - Active semester events, occurrences, and attendance records.
  - Active semester obligation rules and unpaid student charges.
- **STUDENT**:
  - Filtered exclusively by `student_id = auth.user.student_id`.
  - Personal profile, enrollments, attendance, obligations, wallet ledger.
