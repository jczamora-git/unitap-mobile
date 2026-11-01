/**
 * UniTap 2.0 Student Activation, Rate-Limiting & Audit Migration (SQLite)
 * Version 4
 */

export const STUDENT_ACTIVATION_MIGRATION_SQL = `
PRAGMA foreign_keys = OFF;

-- 1. Create activation_claims_audit table
CREATE TABLE IF NOT EXISTS activation_claims_audit (
  id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES activation_claims(id) ON DELETE SET NULL,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('ISSUED','REISSUED','REVOKED','ATTEMPT_FAILED','CLAIMED')),
  performed_by_user_id TEXT REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activation_claims_audit_student 
  ON activation_claims_audit(student_id);

-- 2. Alter activation_claims to add attempt and claim tracking columns
ALTER TABLE activation_claims ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE activation_claims ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 5;
ALTER TABLE activation_claims ADD COLUMN claimed_by_user_id TEXT REFERENCES users(id);
ALTER TABLE activation_claims ADD COLUMN last_attempt_at TEXT;

PRAGMA foreign_keys = ON;
`;

