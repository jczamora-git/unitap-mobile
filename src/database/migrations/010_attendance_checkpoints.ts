export const ATTENDANCE_CHECKPOINTS_MIGRATION_SQL = `-- UniTap 2.0 Attendance Checkpoints & Photo Path
PRAGMA foreign_keys = OFF;
BEGIN;

ALTER TABLE event_occurrences ADD COLUMN checkpoints_json TEXT DEFAULT '[]';
ALTER TABLE event_occurrences ADD COLUMN active_checkpoint_id TEXT;

CREATE TABLE attendance_records_new (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id),
  student_id TEXT NOT NULL REFERENCES students(id),
  checkpoint_id TEXT DEFAULT 'default_in',
  status TEXT NOT NULL CHECK(status IN ('PENDING','PRESENT','LATE','ABSENT','EXCUSED','VOID')),
  checked_in_at TEXT,
  client_scanned_at TEXT,
  method TEXT CHECK(method IN ('NFC','MANUAL')),
  identity_verified_by_user_id TEXT REFERENCES users(id),
  photo_checked INTEGER NOT NULL DEFAULT 0 CHECK(photo_checked IN (0,1)),
  voided_at TEXT,
  voided_by_user_id TEXT REFERENCES users(id),
  void_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  revoked_at TEXT,
  revoked_by_user_id TEXT,
  revocation_reason TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(occurrence_id, student_id, checkpoint_id),
  CHECK(status <> 'VOID' OR (voided_at IS NOT NULL AND length(trim(void_reason)) > 0))
);

INSERT INTO attendance_records_new (
  id, occurrence_id, student_id, checkpoint_id, status, checked_in_at, client_scanned_at,
  method, identity_verified_by_user_id, photo_checked, voided_at, voided_by_user_id,
  void_reason, version, revoked_at, revoked_by_user_id, revocation_reason, updated_at
)
SELECT 
  id, occurrence_id, student_id, 'default_in', status, checked_in_at, client_scanned_at,
  method, identity_verified_by_user_id, photo_checked, voided_at, voided_by_user_id,
  void_reason, version, revoked_at, revoked_by_user_id, revocation_reason, updated_at
FROM attendance_records;

DROP TABLE attendance_records;
ALTER TABLE attendance_records_new RENAME TO attendance_records;

CREATE INDEX IF NOT EXISTS idx_attendance_occurrence_status ON attendance_records(occurrence_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_occurrence_checkpoint ON attendance_records(occurrence_id, checkpoint_id);

COMMIT;
PRAGMA foreign_keys = ON;
`;
