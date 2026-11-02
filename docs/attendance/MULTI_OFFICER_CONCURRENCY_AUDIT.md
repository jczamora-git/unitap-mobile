# UniTap 2.0 — Multi-Officer NFC Attendance Concurrency Audit

**Audit Date:** 2026-11-01  
**Author:** UniTap System Architecture & Security Engineering  
**Scope:** Concurrency, Idempotency, Race Conditions, and Cross-Device Synchronization for NFC Attendance Scanning across Multiple Simultaneous Officer Terminals.

---

## 1. Executive Summary

In a university event environment, 3 to 10 CSG officers may be positioned at different campus gates or entrances, scanning student NFC tags simultaneously for the same event occurrence. 

The previous implementation relied heavily on local SQLite client checks prior to outbox synchronization, with simple blind status writes (`UPDATE %I SET status = %L, updated_at = now()`) in `sync_push_batch`. This presented critical concurrency vulnerabilities:
1. **Blind Status Overwriting & Stale Overwrites:** If Officer A confirms a student and Officer B revokes that student on another terminal, a delayed sync from Officer A's device or a third offline terminal could blindly overwrite the revoked status back to `PRESENT`.
2. **Missing Audit in Pull Synchronization:** `sync_pull_batch` only pulled `attendance_records` and omitted `attendance_audit`. Other officers had no visibility into who revoked an attendance record, when, or why.
3. **No Database-Level Concurrency Control for Scans:** While `attendance_records` has `UNIQUE (occurrence_id, student_id)`, there was no server-side atomic scan RPC to coordinate concurrent officers. A concurrent scan would either hit an unhandled conflict or register as `COLLISION_AUDITED` without distinguishing between a race condition, duplicate check-in, or recheck after revocation.
4. **Silent Revocation Bypass:** If an attendance record was voided/revoked, scanning the card a second time on another terminal would not detect the prior revocation if local SQLite was stale or if the client didn't block re-scanning of revoked records.
5. **Lack of State Versioning:** Without an integer `version` or timestamp-based optimistic concurrency check on attendance rows, conflicting offline mutations could not be deterministically ordered.

---

## 2. Examination of Existing Tables & Schemas

### 2.1 `attendance_records`
- **Primary Key:** `id UUID`
- **Unique Constraint:** `UNIQUE (occurrence_id, student_id)` — *Present in both SQLite and PostgreSQL.*
- **Current Columns:** `id`, `occurrence_id`, `student_id`, `status` (`'PRESENT', 'LATE', 'ABSENT', 'EXCUSED'`), `checked_in_at`, `method`, `photo_checked`, `identity_verified_by_user_id`, `notes`, `updated_at`.
- **Deficiencies Identified:**
  - Status column did not explicitly support `'REVOKED'` with full state-machine transition validation.
  - Lacked an integer `version` column for optimistic concurrency control (`OCC`).
  - Lacked fields for authoritative tracking of `revoked_at`, `revoked_by_user_id`, `revocation_reason`.

### 2.2 `attendance_attempts`
- Stores individual scan events regardless of outcome (e.g., `UNKNOWN_CARD`, `INACTIVE_STUDENT`, `DUPLICATE`, `IDENTITY_REJECTED`).
- Useful for audit and detecting fraud or double-scanning, but previously not synchronized via batch pull.

### 2.3 `attendance_audit`
- Stores historical lifecycle actions (`CHECK_IN`, `VOID`, `RECHECK_APPROVED`).
- **Critical Gap:** Completely missing from `sync_pull_batch`. Terminals running offline-first could never see the revocation notes or identities of officers who performed changes.

---

## 3. High-Risk Concurrency Failure Modes

### Scenario A: Simultaneous Scan Race (Officer 1 & Officer 2 tap same student within milliseconds)
- **Problem:** Both terminals send `CREATE` outbox requests. If processed concurrently:
  - Without atomic server locking, both might attempt inserts.
  - The second will fail the unique constraint `(occurrence_id, student_id)`.
  - Previously, this was caught as `unique_violation` and logged as `COLLISION_AUDITED`, but Officer 2 was left with ambiguous feedback rather than an authoritative `ALREADY_RECORDED` response with the canonical record details.

### Scenario B: Revocation vs. Stale Scan Tap
- **Problem:**
  1. Student taps terminal 1 (Officer 1) → Confirmed `PRESENT`.
  2. Officer 1 notices an infraction or photo discrepancy and revokes attendance → `status = 'REVOKED'`.
  3. Student runs to Gate 2 (Officer 2) and taps again.
  - If Gate 2 is offline or has not synced, Gate 2 might think the student has never checked in or treat it as a new check-in, silently resurrecting the revoked attendance.
  - When Gate 2 pushes to server, server must reject the resurrection with `REVOKED_REVIEW_REQUIRED`!

### Scenario C: Concurrent Revocation by Multiple Officers
- **Problem:** Two officers attempt to void the same record at the same time with different reasons.
- Without optimistic version checks, the last write silently overwrites the reason and audit state.

---

## 4. Architectural Remediation Plan

1. **Database Schema Enhancements:**
   - Add `version INT NOT NULL DEFAULT 1` to `attendance_records`.
   - Add `revoked_at TIMESTAMPTZ`, `revoked_by_user_id UUID`, `revocation_reason TEXT` to `attendance_records`.
   - Ensure `status` allows `'REVOKED'`.
2. **Atomic Server RPCs:**
   - `record_attendance_scan(...)`: Atomically checks occurrence status (`OPEN`), validates officer permissions, verifies student enrollment/eligibility, acquires row lock if record exists, enforces idempotency, inserts or returns `ALREADY_RECORDED` or `REVOKED_REVIEW_REQUIRED`.
   - `revoke_attendance(...)`: Atomically transitions active attendance (`PRESENT`/`LATE`) to `REVOKED`, increments version, writes to `attendance_audit`.
   - `recheck_attendance(...)`: Explicit officer workflow to override `REVOKED` state after visual verification, requiring an explanation, transitioning to `PRESENT`/`LATE` and logging `RECHECK_APPROVED` in `attendance_audit`.
3. **Synchronisation Improvements:**
   - Add `attendance_audit` to `sync_pull_batch`.
   - Handle attendance operations idempotently in `sync_push_batch`.
   - Realtime broadcast on `attendance_records` to immediately refresh other officer terminals.
4. **Client & UI Adaptations:**
   - Surface `REVOKED_REVIEW_REQUIRED` banner with revocation history and reason.
   - Provide explicit "Approve Recheck" modal for authorized officers with photo confirmation.

