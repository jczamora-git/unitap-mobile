# UniTap 2.0 — Student Self-Registration and Account Activation Security Specification

**Document Reference**: SEC-SPEC-004  
**Date**: 2026-11-01  
**Status**: APPROVED & IMPLEMENTED  
**Target Systems**: Supabase Auth, PostgreSQL 15, SQLite 3, Ionic Vue 9  

---

## 1. Overview and Mission

UniTap is an offline-first application for university student government attendance, academic records, and financial obligations. Student records and semester enrollments are pre-populated into the database by authorized officers using official CSV roster imports. 

The **Student Self-Registration and Account Activation** system allows imported students to securely create and claim their personal digital accounts without:
1. Creating duplicate student profiles.
2. Allowing unauthorized claims or identity spoofing using publicly known School IDs alone.
3. Exposing plaintext activation credentials in persistent storage or client logs.
4. Permitting brute-force or timing enumeration attacks.

---

## 2. Threat Model & Security Mitigations

| Threat Vector | Severity | Vulnerability Description | UniTap 2.0 Security Mitigation |
|---|---|---|---|
| **School ID Enumeration** | High | Attacker guesses or scrapes School IDs to determine whether a student is enrolled. | All verification failure responses use generic messages: `"Invalid activation code or school ID."` No student profile information is ever returned prior to verified activation. |
| **Code Brute-Force** | High | Attacker attempts to guess the 8-character activation code. | `attempt_count` is tracked per claim. Submitting 5 incorrect codes permanently revokes the code (`revoked_at = now()`), triggering `REQUIRES_ATTENTION` and logging `ATTEMPT_FAILED`. |
| **Plaintext Leakage** | Critical | Officer or database inspection compromises unconsumed codes. | Activation codes are hashed using SHA-256 (`hash-wasm`). Only the 64-character hex hash is persisted in `activation_claims`. Plaintext is presented to the issuing officer **once** in memory and never displayed again. |
| **Account Hijacking / Multi-Claim** | Critical | Attacker links their Auth user to another student, or links multiple students. | PostgreSQL enforces `CREATE UNIQUE INDEX uq_users_student_id ON users(student_id) WHERE student_id IS NOT NULL;`. The `activate_student_account` RPC verifies that neither the student nor the Auth user is previously linked. |
| **Race Conditions** | High | Concurrent activation requests attempt to claim the same code simultaneously. | Activation, claim consumption, user creation, role assignment, and audit logging occur inside an atomic PostgreSQL transaction with row-level locks. |
| **Client Role Tampering** | Critical | Client alters Supabase metadata or local state to elevate role to `OFFICER` or `DEVADMIN`. | The `STUDENT` role is assigned strictly inside the trusted `activate_student_account` `SECURITY DEFINER` function on the server. Client-supplied role metadata is ignored. |
| **Unlinked Auth Exposure** | High | An authenticated user with no linked student record attempts to query student data. | PostgreSQL Row-Level Security (RLS) policies permit student queries **only** when `student_id = (SELECT student_id FROM users WHERE id = auth.uid())`. Unlinked users receive 0 rows. |

---

## 3. End-to-End Activation Workflow

```
[Institutional CSV Import] 
         │ (Creates student record & semester enrollment; no auth user)
         ▼
[Officer Issues Activation Code] 
         │ (Generates 8-char code, stores SHA-256 hash, hands slip to student)
         ▼
[Student Opens Registration Page (/register)]
         │ (Enters School ID, Activation Code, Email, Password)
         ▼
[Supabase Auth signUp()] 
         │ (Establishes auth identity in auth.users)
         ▼
[Server RPC: activate_student_account()] 
         │ (Validates eligibility, enforces attempt limit, checks expiration,
         │  consumes claim, updates users.student_id, assigns STUDENT role)
         ▼
[Role-Scoped SQLite Hydration (/initial-sync)] 
         │ (Downloads only student's own attendance, obligations, receipts)
         ▼
[Student Personal Dashboard]
```

---

## 4. Database Schema Changes

### 4.1 PostgreSQL Schema (`supabase/migrations/20261101000000_student_activation_and_rls.sql`)
1. **`uq_users_student_id`**:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student_id 
     ON users(student_id) 
     WHERE student_id IS NOT NULL;
   ```
2. **`activation_claims` Columns**:
   - `attempt_count INT NOT NULL DEFAULT 0`
   - `max_attempts INT NOT NULL DEFAULT 5`
   - `claimed_by_user_id UUID REFERENCES users(id)`
   - `last_attempt_at TIMESTAMPTZ`
3. **`activation_claims_audit`**:
   - `claim_id UUID REFERENCES activation_claims(id)`
   - `student_id UUID NOT NULL REFERENCES students(id)`
   - `action VARCHAR(30) NOT NULL` (`ISSUED`, `REISSUED`, `REVOKED`, `ATTEMPT_FAILED`, `CLAIMED`)
   - `performed_by_user_id UUID REFERENCES users(id)`
   - `notes TEXT`
   - `created_at TIMESTAMPTZ DEFAULT now()`

### 4.2 SQLite Schema (`src/database/migrations/004_student_activation_audit.sql`)
Identical table structure and columns replicated locally for offline consistency and development testing.

---

## 5. Row-Level Security (RLS) Policy Reference

```sql
-- Students view only own profile
CREATE POLICY "Students view own profile only" ON students
  FOR SELECT USING (
    id = (SELECT student_id FROM users WHERE id = auth.uid())
  );

-- Officers view students within active semester
CREATE POLICY "Officers manage all students" ON students
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );

-- Activation claims accessible only by authorized officers
CREATE POLICY "Officers manage activation claims" ON activation_claims
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
  );
```

---

## 6. Officer Activation Management

Officers view student activation status on each student profile (`StudentProfilePage.vue`):

- **`NOT_ACTIVATED`**: Student was imported via CSV; no activation code has been generated.
- **`ACTIVATION_PENDING`**: Activation code has been issued and is valid for 48 hours. Displays expiration and failed attempt count.
- **`ACTIVATED`**: Student account successfully claimed; displays linked username and timestamp.
- **`REQUIRES_ATTENTION`**: Code expired or revoked due to 5 consecutive failed attempts. Requires officer reissue.

**Plaintext Non-Exposure Rule**:
When an officer clicks *Issue Activation Code* or *Reissue Code*, the 8-character plaintext code is displayed in a dedicated presentation sheet with a single-click *Copy Code* button. Once dismissed, the plaintext is discarded from memory. Only the SHA-256 hash remains in the database.

