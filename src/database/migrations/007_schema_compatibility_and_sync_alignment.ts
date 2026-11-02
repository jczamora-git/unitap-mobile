export const SCHEMA_COMPATIBILITY_MIGRATION_SQL = `
-- ============================================================================
-- UniTap 2.0 SQLite Schema Compatibility & Safe Data Ingestion Migration
-- Migration 007
-- Objective:
--   Add missing PostgreSQL-aligned columns to existing SQLite tables without
--   resetting databases, preserving all existing records, outbox mutations,
--   foreign keys, and constraints.
-- ============================================================================

-- 1. ACADEMIC STRUCTURE TIMESTAMPS & STATUS ALIGNMENT
ALTER TABLE academic_years ADD COLUMN created_at TEXT;
ALTER TABLE academic_years ADD COLUMN updated_at TEXT;

ALTER TABLE semesters ADD COLUMN created_at TEXT;
ALTER TABLE semesters ADD COLUMN updated_at TEXT;

ALTER TABLE programs ADD COLUMN status TEXT DEFAULT 'ACTIVE';

-- 2. EVENT & PARTICIPANT PARITY
ALTER TABLE event_occurrences ADD COLUMN label TEXT;
ALTER TABLE event_participants ADD COLUMN added_at TEXT;
ALTER TABLE event_participants ADD COLUMN updated_at TEXT;

-- 3. STUDENT & ENROLLMENT PARITY
ALTER TABLE students ADD COLUMN photo_storage_path TEXT;
ALTER TABLE student_enrollments ADD COLUMN academic_year_id TEXT;

-- 4. NFC CARDS & ATTENDANCE PARITY
ALTER TABLE nfc_cards ADD COLUMN deactivated_at TEXT;
ALTER TABLE nfc_cards ADD COLUMN note TEXT;
ALTER TABLE nfc_cards ADD COLUMN updated_at TEXT;

ALTER TABLE attendance_records ADD COLUMN notes TEXT;

-- 5. FINANCE & OBLIGATION PARITY
ALTER TABLE obligation_rules ADD COLUMN updated_at TEXT;

ALTER TABLE payments ADD COLUMN updated_at TEXT;
ALTER TABLE payment_allocations ADD COLUMN created_at TEXT;
`;
