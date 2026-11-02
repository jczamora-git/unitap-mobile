export const ENTITY_CHECKPOINTS_MIGRATION_SQL = `
-- ============================================================================
-- UniTap 2.0 SQLite Entity Sync Checkpoints Migration
-- Migration 008
-- Objective:
--   Create entity_sync_checkpoints table to enable durable, per-entity
--   lossless pagination, atomic transaction commits, and failure rollback.
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_sync_checkpoints (
  entity_name TEXT PRIMARY KEY NOT NULL,
  last_pulled_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  last_pulled_id TEXT DEFAULT NULL,
  records_pulled INTEGER NOT NULL DEFAULT 0,
  last_sync_status TEXT NOT NULL DEFAULT 'IDLE',
  last_error_message TEXT DEFAULT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO entity_sync_checkpoints (entity_name, last_pulled_at, last_pulled_id, records_pulled, last_sync_status, updated_at)
VALUES
  ('academic_years', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('semesters', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('programs', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('year_levels', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('sections', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('event_categories', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('events', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('event_occurrences', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('students', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('student_enrollments', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('nfc_cards', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('event_participants', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('attendance_records', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('attendance_audit', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('obligation_rules', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('student_obligations', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('payments', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP),
  ('payment_allocations', '1970-01-01T00:00:00.000Z', NULL, 0, 'IDLE', CURRENT_TIMESTAMP);
`;

