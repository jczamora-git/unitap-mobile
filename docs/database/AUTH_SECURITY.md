# UniTap 2.0 Authentication & Security Architecture

## 1. Core Principles

UniTap 2.0 adopts a **hybrid authentication model**:
1. **Online Authority (Supabase Auth)**:
   - Primary credential validation, password updates, email verification, and JWT issuance are managed exclusively by Supabase Auth.
   - Passwords are never stored in the local SQLite database.
   - First-time login on any device requires active internet connectivity.
2. **Offline Session Access (Device-Bound Cached Ticket)**:
   - After a successful online login, a cryptographically signed session ticket is cached in protected device storage (`@capacitor/preferences` with AES hardware keystore backing on Android).
   - An offline-access expiration window (default: 7 days) allows officers to operate attendance sessions without network access.
   - If offline access expires, the user must reconnect to re-authenticate with Supabase.

---

## 2. Student Self-Registration & Account Activation

To protect student privacy and avoid account harvesting:
1. Students cannot self-register without an existing imported roster record.
2. An authorized officer issues an 8-character single-use activation code (e.g., `H84K9X2M`).
3. The server computes `SHA-256(rawCode)` and stores it in `activation_claims` with a 48-hour expiration.
4. During registration, the student submits:
   - School ID (e.g. `2026-0001`)
   - 8-character activation code
   - Email address
   - Password (minimum 8 characters)
5. The Supabase RPC `verify_and_claim_student_code(school_id, code_hash)` verifies the claim inside a single database transaction, invalidates the code (`used_at = now()`), and links the student's Supabase Auth user ID to their student profile in `students`.
6. Public self-registration assigns ONLY the `STUDENT` role. DevAdmin and Officer accounts cannot be created through this endpoint.

---

## 3. Role-Based Access Control (RBAC)

Three initial roles are enforced across PostgreSQL RLS, edge RPCs, and client route guards:

### DEVADMIN
- Unrestricted administrative authority.
- Manages academic terms, semester status, and officer role assignments.
- Authorizes and revokes mobile device hardware IDs.
- System-wide forensics and audit logging access.

### OFFICER
- Attendance session management and real-time NFC verification.
- Reviewing student roster data, importing CSV rosters.
- Recording cash payments and issuing fines / contributions.
- Restricted to active semesters and assigned programs.

### STUDENT
- Strictly personal read-only dashboard: profile, ID photo, academic history, event attendance, outstanding obligations, and payment receipts.
- Cannot view or search other students' data.
- Submits semester profile confirmation updates for officer review.

---

## 4. Row Level Security (RLS) Specifications

All Supabase tables have RLS enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`).

1. **`students`**:
   - `SELECT`: `auth.uid() IN (SELECT user_id FROM user_roles WHERE role IN ('DEVADMIN', 'OFFICER')) OR auth.uid() IN (SELECT id FROM users WHERE student_id = students.id)`
   - `UPDATE`: `auth.uid() IN (SELECT user_id FROM user_roles WHERE role = 'DEVADMIN')` or assigned officer.
2. **`attendance_records`**:
   - `SELECT`: Officer/DevAdmin or the student matching `student_id`.
   - `INSERT`: Officers with active semester assignment.
3. **`student_obligations` & `payments`**:
   - `SELECT`: Officer/DevAdmin or the student matching `student_id`.
   - `INSERT / UPDATE`: Officers / DevAdmins only.

