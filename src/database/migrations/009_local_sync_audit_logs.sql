-- ============================================================================
-- UniTap 2.0 Local-Only Sync Audit Logs Migration
-- Migration 009
-- Objective:
--   Create local-only sync_audit_logs table to provide complete transparency
--   and diagnostics for all synchronization operations (Push, Pull, Reconcile).
--   This table is STRICTLY local to SQLite / IndexedDB and is NEVER synced to Supabase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT DEFAULT NULL,
  timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  direction TEXT NOT NULL CHECK(direction IN ('PUSH', 'PULL', 'RECONCILE')),
  entity_type TEXT NOT NULL,
  record_id TEXT DEFAULT NULL,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('CREATE', 'UPDATE', 'DELETE', 'VOID', 'UPSERT', 'PULL_BATCH', 'RECONCILE', 'RETRY')),
  status TEXT NOT NULL CHECK(status IN ('SUCCESS', 'FAILED', 'CONFLICT', 'SKIPPED')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  server_ack_ref TEXT DEFAULT NULL,
  error_code TEXT DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  details_json TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_audit_logs_timestamp ON sync_audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sync_audit_logs_direction_status ON sync_audit_logs(direction, status);
CREATE INDEX IF NOT EXISTS idx_sync_audit_logs_entity ON sync_audit_logs(entity_type);

