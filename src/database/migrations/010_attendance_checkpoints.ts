export const ATTENDANCE_CHECKPOINTS_MIGRATION_SQL = `-- UniTap 2.0 Attendance Checkpoints & Photo Path
BEGIN;

ALTER TABLE event_occurrences ADD COLUMN checkpoints_json TEXT DEFAULT '[]';
ALTER TABLE event_occurrences ADD COLUMN active_checkpoint_id TEXT;
ALTER TABLE attendance_records ADD COLUMN checkpoint_id TEXT DEFAULT 'default_in';

COMMIT;
`;

