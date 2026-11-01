# UniTap 2.0 — Multi-Officer NFC Attendance Concurrency Implementation

**Implementation Date:** 2026-11-01  
**Status:** Completed & Verified  
**Architecture:** Supabase PostgreSQL + SQLite Offline-First Relational Engine

---

## 1. System Overview & Problem Statement

In live university events, multiple CSG officers simultaneously operate NFC terminals to scan attendees at entrance doors or checkpoints. Prior to this implementation:
- Scanning the same student on two terminals could cause uncoordinated writes and lost updates.
- If an officer revoked an attendance, a subsequent tap on another terminal could silently resurrect the student's status to `PRESENT`.
- Audit logs for revocations (`attendance_audit`) were never pulled by client terminals during synchronization.
- Terminals lacked optimistic concurrency controls (`version`), preventing deterministic conflict resolution.

---

## 2. Server-Side PostgreSQL Architecture

### 2.1 Database Schema Alterations
Migration file: `supabase/migrations/20261101191000_multi_officer_attendance_concurrency.sql`

- **Optimistic Concurrency Control (OCC):**
  Added `version INT NOT NULL DEFAULT 1` to `attendance_records`.
- **Authoritative Revocation Audit Tracking:**
  Added `revoked_at TIMESTAMPTZ`, `revoked_by_user_id UUID REFERENCES users(id)`, and `revocation_reason TEXT` to `attendance_records`.
- **Indexed Lookups:**
  Created `idx_attendance_records_occ_status` on `(occurrence_id, status)` and `idx_attendance_audit_att_id` on `(attendance_id, performed_at DESC)`.
- **Database Publication for Realtime:**
  Registered `attendance_records` and `attendance_audit` in `supabase_realtime` publication.

### 2.2 Atomic Scan Confirmation (`record_attendance_scan`)
- **Signature:**
  `record_attendance_scan(p_occurrence_id UUID, p_student_id UUID, p_nfc_card_id UUID, p_uid_normalized VARCHAR, p_status_override VARCHAR, p_device_id TEXT, p_idempotency_key TEXT)`
- **Behavior:**
  1. Authenticates calling officer (`auth.uid()`) and verifies active `OFFICER` or `DEVADMIN` role.
  2. Ensures the event occurrence is in `OPEN` state.
  3. Acquires row lock `FOR UPDATE` on `attendance_records` for `(p_occurrence_id, p_student_id)`.
  4. If record exists:
     - If `REVOKED`: Rejects automatic re-confirmation and returns `REVOKED_REVIEW_REQUIRED` along with previous revoker username, timestamp, and reason.
     - If `PRESENT` or `LATE`: Returns `ALREADY_RECORDED` with canonical attendance details.
     - If `ABSENT`: Reinstates to `PRESENT` / `LATE` with audit logging.
  5. If record does not exist:
     - Calculates grace period (`PRESENT` vs `LATE`).
     - Inserts canonical record with `version = 1`.
     - Appends immutable `CHECK_IN` record to `attendance_audit`.
     - Logs attempt to `attendance_attempts`.
     - Returns `RECORDED`.
  6. Catches `unique_violation` during millisecond concurrency races and safely returns `ALREADY_RECORDED`.

### 2.3 Atomic Revocation (`revoke_attendance`)
- **Signature:**
  `revoke_attendance(p_attendance_id UUID, p_reason TEXT, p_expected_version INT)`
- **Behavior:**
  1. Authenticates officer and enforces non-empty mandatory reason.
  2. Acquires row lock `FOR UPDATE` on `attendance_records`.
  3. Verifies `version == p_expected_version` (if provided) to reject stale-state actions.
  4. Transitions status to `REVOKED`, populates `revoked_at`, `revoked_by_user_id`, `revocation_reason`, and increments `version`.
  5. Appends immutable `REVOKE` entry into `attendance_audit`.

### 2.4 Atomic Recheck Approval (`recheck_attendance`)
- **Signature:**
  `recheck_attendance(p_attendance_id UUID, p_reason TEXT, p_target_status VARCHAR)`
- **Behavior:**
  1. Requires officer authorization and non-empty reason.
  2. Transitions `REVOKED` record back to `PRESENT` or `LATE`.
  3. Clears revocation fields, updates `identity_verified_by_user_id`, and increments `version`.
  4. Appends immutable `RECHECK_APPROVED` entry into `attendance_audit`.

### 2.5 Batch Pull Integration (`sync_pull_batch`)
Added `attendance_audit` to the single-transaction batch pull payload so all terminals download recent revocations, reasons, and acting officer IDs.

---

## 3. Client & Offline-First Implementation

### 3.1 Local SQLite Database
- Applied migration `006_attendance_concurrency_audit`:
  - Added `version`, `revoked_at`, `revoked_by_user_id`, `revocation_reason` to local `attendance_records`.
  - Added `occurrence_id`, `student_id`, `performed_by_user_id`, `performed_at` to local `attendance_audit`.

### 3.2 Attendance Repository (`attendance.repository.ts`)
- `recordAttendance()`: Enforces optimistic versioning and transactional outbox write.
- `voidAttendance()`: Atomically marks record as `VOID` / `REVOKED`, inserts audit log, and enqueues `VOID` operation to `sync_outbox`.
- `recheckAttendance()`: Reinstates record to `PRESENT` or `LATE`, logs `REINSTATE`, and enqueues `UPDATE` operation to `sync_outbox`.
- `getAuditTrail()`: Retrieves chronological audit history for any attendance record.

### 3.3 Domain Service (`attendance.service.ts`)
- `prepareNfcVerification()`: Inspects existing record; if `REVOKED` or `VOID`, returns `type: 'REVOKED_REVIEW_REQUIRED'` to block automatic check-in.
- `confirmStudentAttendance()`: Calls online RPC `record_attendance_scan` when connected; falls back to local SQLite transaction when offline.
- `voidAttendance()`: Dispatches to `revoke_attendance` online and writes to local SQLite outbox.
- `recheckStudentAttendance()`: Dispatches to `recheck_attendance` online and updates local SQLite outbox.

### 3.4 User Interface (`AttendanceScanPage.vue`)
- Displays `REVOKED_REVIEW_REQUIRED` warning badge.
- Shows previous revocation reason and timestamp.
- Renders **Approve Recheck** action button requiring explicit officer confirmation and explanation.
