# UniTap 2.0 Conflict Resolution & Concurrency Rules

UniTap 2.0 avoids naive "Last-Write-Wins" for critical operational and financial records. The following rules govern concurrent updates:

---

## 1. Attendance Records

- **Constraint**: A student can only have one confirmed attendance record (`PRESENT` or `LATE`) per `event_occurrence`.
- **Conflict Handling**:
  - If Device A records attendance for Student X, and Device B also records attendance while both are offline:
  - First receipt to reach Supabase is accepted as valid check-in.
  - Second receipt triggers an idempotency acknowledgement with a conflict log (`DUPLICATE_ACCEPTED_ATTENDANCE`).
  - Attendance voids require an existing valid attendance record; voiding is append-only via `attendance_voids` with audit reason.

---

## 2. NFC Card Assignments

- **Constraint**: An NFC card (`uid_normalized`) can only be active for one student at a time.
- **Conflict Handling**:
  - If two officers assign the same card to different students offline:
  - The first assignment committed on Supabase takes precedence.
  - The second assignment is marked `REJECTED_CARD_CONFLICT` on the server and returned to the client outbox.
  - An audit log alerts the officer that the card is already in possession of another student.

---

## 3. Financial Payments & Simulated Wallet

- **Constraint**: Wallet balance cannot drop below zero. Payment allocations must equal payment total.
- **Conflict Handling**:
  - Offline wallet payments are committed with `status = 'PROVISIONAL'`.
  - When synced, Supabase validates the wallet balance against server-authoritative ledger entries.
  - If balance is sufficient, the transaction is marked `'POSTED'`.
  - If funds are insufficient (e.g. concurrent spending on another terminal), the payment is marked `'REJECTED_INSUFFICIENT_FUNDS'` and recorded in `sync_conflicts` for officer resolution.

---

## 4. Student Profiles & Enrollments

- **Rule**: Field-level merge for profile updates.
- Verified academic identifiers (`school_id`) and enrollment standings are server-authoritative and can only be altered by authorized DevAdmins.

