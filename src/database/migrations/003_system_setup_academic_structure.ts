/**
 * UniTap 2.0 DevAdmin-Only System Setup & Academic Structure Migration
 * Version 3: Event Categories, Year Levels, Sections, Academic Years & Semesters
 * LOCAL SQLITE ENGINE ONLY
 */

export const SYSTEM_SETUP_MIGRATION_SQL = `
PRAGMA foreign_keys = OFF;

-- 1. EVENT CATEGORIES
CREATE TABLE IF NOT EXISTS event_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed initial default event categories with stable RFC 4122 UUIDs
INSERT OR IGNORE INTO event_categories (id, name, description, code, status, sort_order, created_at, updated_at)
VALUES
  ('ec000000-0000-4000-8000-000000000001', 'General Assembly', 'Institutional or departmental general meetings and assemblies', 'GA', 'ACTIVE', 1, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('ec000000-0000-4000-8000-000000000002', 'Cleanup Drive', 'Community and campus environmental cleanup drives', 'CLEANUP', 'ACTIVE', 2, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('ec000000-0000-4000-8000-000000000003', 'Sportsfest', 'Intramural athletic tournaments and sports events', 'SPORTS', 'ACTIVE', 3, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('ec000000-0000-4000-8000-000000000004', 'IT Day', 'Information Technology departmental conference and workshops', 'IT_DAY', 'ACTIVE', 4, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('ec000000-0000-4000-8000-000000000005', 'Orientation', 'New student orientation and welcoming assemblies', 'ORIENTATION', 'ACTIVE', 5, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('ec000000-0000-4000-8000-000000000006', 'Seminar', 'Technical seminars, lectures, and academic colloquia', 'SEMINAR', 'ACTIVE', 6, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('ec000000-0000-4000-8000-000000000007', 'Other', 'General miscellaneous organizational events', 'OTHER', 'ACTIVE', 7, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');

-- Alter events table to add category_id
ALTER TABLE events ADD COLUMN category_id TEXT REFERENCES event_categories(id);

-- Backfill category_id for existing events matching category name or code
UPDATE events
SET category_id = (
  SELECT id FROM event_categories
  WHERE lower(event_categories.name) = lower(events.event_type)
     OR event_categories.code = events.event_type
  LIMIT 1
)
WHERE category_id IS NULL;

-- 2. YEAR LEVELS
CREATE TABLE IF NOT EXISTS year_levels (
  id TEXT PRIMARY KEY,
  level_number INTEGER NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed initial 1st to 4th year levels with stable RFC 4122 UUIDs
INSERT OR IGNORE INTO year_levels (id, level_number, display_name, status, sort_order, created_at, updated_at)
VALUES
  ('e1000000-0000-4000-8000-000000000001', 1, '1st Year', 'ACTIVE', 1, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('e1000000-0000-4000-8000-000000000002', 2, '2nd Year', 'ACTIVE', 2, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('e1000000-0000-4000-8000-000000000003', 3, '3rd Year', 'ACTIVE', 3, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('e1000000-0000-4000-8000-000000000004', 4, '4th Year', 'ACTIVE', 4, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');

-- 3. SECTIONS (One Year Level -> Many Sections)
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  section_name TEXT NOT NULL,
  year_level_id TEXT NOT NULL REFERENCES year_levels(id),
  program_id TEXT REFERENCES programs(id),
  academic_year_id TEXT REFERENCES academic_years(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_scope 
ON sections(section_name, year_level_id, coalesce(program_id, ''), coalesce(academic_year_id, ''));

-- Seed default initial sections for BSIT year levels with stable RFC 4122 UUIDs
INSERT OR IGNORE INTO sections (id, section_name, year_level_id, status, created_at, updated_at)
VALUES
  ('eb000000-0000-4000-8000-000000000001', '1F1', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000002', '1F2', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000003', '1F3', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000004', '1F4', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000005', '2F1', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000006', '2F2', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000007', '2F3', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000008', '2F4', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000009', '3F1', 'e1000000-0000-4000-8000-000000000003', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000010', '3F4', 'e1000000-0000-4000-8000-000000000003', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000011', '3F5', 'e1000000-0000-4000-8000-000000000003', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000012', '4F1', 'e1000000-0000-4000-8000-000000000004', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000013', '4F4', 'e1000000-0000-4000-8000-000000000004', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z'),
  ('eb000000-0000-4000-8000-000000000014', '4F5', 'e1000000-0000-4000-8000-000000000004', 'ACTIVE', '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');

-- 4. STUDENT ENROLLMENTS
ALTER TABLE student_enrollments ADD COLUMN year_level_id TEXT REFERENCES year_levels(id);
ALTER TABLE student_enrollments ADD COLUMN section_id TEXT REFERENCES sections(id);

-- Backfill year_level_id and section_id from existing numeric year and section text
UPDATE student_enrollments
SET year_level_id = (
  SELECT id FROM year_levels WHERE year_levels.level_number = student_enrollments.year_level LIMIT 1
)
WHERE year_level_id IS NULL;

UPDATE student_enrollments
SET section_id = (
  SELECT id FROM sections WHERE lower(sections.section_name) = lower(trim(student_enrollments.section)) LIMIT 1
)
WHERE section_id IS NULL;

-- 5. DATA PRESERVING UPGRADE FOR LEGACY IDENTIFIERS (IF PRESENT)
UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000001' WHERE category_id = 'cat_ga';
UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000002' WHERE category_id = 'cat_cleanup';
UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000003' WHERE category_id = 'cat_sports';
UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000004' WHERE category_id = 'cat_it_day';
UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000005' WHERE category_id = 'cat_orientation';
UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000006' WHERE category_id = 'cat_seminar';
UPDATE events SET category_id = 'ec000000-0000-4000-8000-000000000007' WHERE category_id = 'cat_other';

UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000001' WHERE id = 'cat_ga';
UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000002' WHERE id = 'cat_cleanup';
UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000003' WHERE id = 'cat_sports';
UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000004' WHERE id = 'cat_it_day';
UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000005' WHERE id = 'cat_orientation';
UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000006' WHERE id = 'cat_seminar';
UPDATE event_categories SET id = 'ec000000-0000-4000-8000-000000000007' WHERE id = 'cat_other';

UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000001' WHERE year_level_id = 'yl_1';
UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000002' WHERE year_level_id = 'yl_2';
UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000003' WHERE year_level_id = 'yl_3';
UPDATE sections SET year_level_id = 'e1000000-0000-4000-8000-000000000004' WHERE year_level_id = 'yl_4';

UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000001' WHERE year_level_id = 'yl_1';
UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000002' WHERE year_level_id = 'yl_2';
UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000003' WHERE year_level_id = 'yl_3';
UPDATE student_enrollments SET year_level_id = 'e1000000-0000-4000-8000-000000000004' WHERE year_level_id = 'yl_4';

UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000001' WHERE id = 'yl_1';
UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000002' WHERE id = 'yl_2';
UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000003' WHERE id = 'yl_3';
UPDATE year_levels SET id = 'e1000000-0000-4000-8000-000000000004' WHERE id = 'yl_4';

UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000001' WHERE section_id = 'sec_1f1';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000002' WHERE section_id = 'sec_1f2';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000003' WHERE section_id = 'sec_1f3';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000004' WHERE section_id = 'sec_1f4';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000005' WHERE section_id = 'sec_2f1';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000006' WHERE section_id = 'sec_2f2';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000007' WHERE section_id = 'sec_2f3';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000008' WHERE section_id = 'sec_2f4';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000009' WHERE section_id = 'sec_3f1';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000010' WHERE section_id = 'sec_3f4';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000011' WHERE section_id = 'sec_3f5';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000012' WHERE section_id = 'sec_4f1';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000013' WHERE section_id = 'sec_4f4';
UPDATE student_enrollments SET section_id = 'eb000000-0000-4000-8000-000000000014' WHERE section_id = 'sec_4f5';

UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000001' WHERE id = 'sec_1f1';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000002' WHERE id = 'sec_1f2';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000003' WHERE id = 'sec_1f3';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000004' WHERE id = 'sec_1f4';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000005' WHERE id = 'sec_2f1';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000006' WHERE id = 'sec_2f2';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000007' WHERE id = 'sec_2f3';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000008' WHERE id = 'sec_2f4';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000009' WHERE id = 'sec_3f1';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000010' WHERE id = 'sec_3f4';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000011' WHERE id = 'sec_3f5';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000012' WHERE id = 'sec_4f1';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000013' WHERE id = 'sec_4f4';
UPDATE sections SET id = 'eb000000-0000-4000-8000-000000000014' WHERE id = 'sec_4f5';

PRAGMA foreign_keys = ON;
`;
