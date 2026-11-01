export const ATTENDANCE_CONCURRENCY_MIGRATION_SQL = `
-- UniTap 2.0: Multi-Officer NFC Attendance Concurrency & Revocation History
-- Alters local SQLite schema to support optimistic versioning, revocation details, and audit parity.

ALTER TABLE attendance_records ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE attendance_records ADD COLUMN revoked_at TEXT;
ALTER TABLE attendance_records ADD COLUMN revoked_by_user_id TEXT;
ALTER TABLE attendance_records ADD COLUMN revocation_reason TEXT;

ALTER TABLE attendance_audit ADD COLUMN occurrence_id TEXT;
ALTER TABLE attendance_audit ADD COLUMN student_id TEXT;
ALTER TABLE attendance_audit ADD COLUMN performed_by_user_id TEXT;
ALTER TABLE attendance_audit ADD COLUMN performed_at TEXT;
`;
