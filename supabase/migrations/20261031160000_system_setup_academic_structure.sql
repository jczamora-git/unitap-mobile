-- ============================================================================
-- UniTap 2.0 DevAdmin-Only System Setup & Academic Structure Migration
-- Migration: 20261031160000_system_setup_academic_structure.sql
-- TARGET ENGINE: Supabase PostgreSQL (Standard RFC 4122 UUID compliant)
-- DO NOT EXECUTE SQLITE STATEMENTS (NO PRAGMA, NO INSERT OR IGNORE)
-- ============================================================================

-- 0. Security Definer Role Resolver (Idempotent)
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM user_roles
  WHERE user_id = auth.uid()
    AND revoked_at IS NULL
  ORDER BY CASE role WHEN 'DEVADMIN' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END
  LIMIT 1;
$$;

-- 1. EVENT CATEGORIES
CREATE TABLE IF NOT EXISTS event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  code VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  sort_order INT NOT NULL DEFAULT 0,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_categories_unique_name ON event_categories(lower(trim(name)));

-- Seed standard initial categories with stable RFC 4122 UUIDs matching SQLite
INSERT INTO event_categories (id, name, description, code, status, sort_order)
VALUES
  ('ec000000-0000-4000-8000-000000000001', 'General Assembly', 'Institutional or departmental general meetings and assemblies', 'GA', 'ACTIVE', 1),
  ('ec000000-0000-4000-8000-000000000002', 'Cleanup Drive', 'Community and campus environmental cleanup drives', 'CLEANUP', 'ACTIVE', 2),
  ('ec000000-0000-4000-8000-000000000003', 'Sportsfest', 'Intramural athletic tournaments and sports events', 'SPORTS', 'ACTIVE', 3),
  ('ec000000-0000-4000-8000-000000000004', 'IT Day', 'Information Technology departmental conference and workshops', 'IT_DAY', 'ACTIVE', 4),
  ('ec000000-0000-4000-8000-000000000005', 'Orientation', 'New student orientation and welcoming assemblies', 'ORIENTATION', 'ACTIVE', 5),
  ('ec000000-0000-4000-8000-000000000006', 'Seminar', 'Technical seminars, lectures, and academic colloquia', 'SEMINAR', 'ACTIVE', 6),
  ('ec000000-0000-4000-8000-000000000007', 'Other', 'General miscellaneous organizational events', 'OTHER', 'ACTIVE', 7)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    sort_order = EXCLUDED.sort_order;

-- Alter events table to add category_id foreign key
ALTER TABLE events ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES event_categories(id);

-- Backfill events category_id
UPDATE events
SET category_id = ec.id
FROM event_categories ec
WHERE events.category_id IS NULL
  AND (lower(trim(events.event_type)) = lower(trim(ec.name)) OR events.event_type = ec.code);

-- 2. YEAR LEVELS
CREATE TABLE IF NOT EXISTS year_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_number INT NOT NULL UNIQUE,
  display_name VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default year levels with stable RFC 4122 UUIDs matching SQLite
INSERT INTO year_levels (id, level_number, display_name, status, sort_order)
VALUES
  ('e1000000-0000-4000-8000-000000000001', 1, '1st Year', 'ACTIVE', 1),
  ('e1000000-0000-4000-8000-000000000002', 2, '2nd Year', 'ACTIVE', 2),
  ('e1000000-0000-4000-8000-000000000003', 3, '3rd Year', 'ACTIVE', 3),
  ('e1000000-0000-4000-8000-000000000004', 4, '4th Year', 'ACTIVE', 4)
ON CONFLICT (level_number) DO UPDATE
SET display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
    sort_order = EXCLUDED.sort_order;

-- 3. SECTIONS (One Year Level -> Many Sections)
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_name VARCHAR(50) NOT NULL,
  year_level_id UUID NOT NULL REFERENCES year_levels(id) ON DELETE RESTRICT,
  program_id UUID REFERENCES programs(id) ON DELETE SET NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_scope_unique
ON sections(
  lower(trim(section_name)),
  year_level_id,
  coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(academic_year_id, '00000000-0000-0000-0000-000000000000'::uuid)
);

-- Seed default sections for year levels with stable RFC 4122 UUIDs matching SQLite
INSERT INTO sections (id, section_name, year_level_id, status)
VALUES
  ('eb000000-0000-4000-8000-000000000001', '1F1', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000002', '1F2', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000003', '1F3', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000004', '1F4', 'e1000000-0000-4000-8000-000000000001', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000005', '2F1', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000006', '2F2', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000007', '2F3', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000008', '2F4', 'e1000000-0000-4000-8000-000000000002', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000009', '3F1', 'e1000000-0000-4000-8000-000000000003', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000010', '3F4', 'e1000000-0000-4000-8000-000000000003', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000011', '3F5', 'e1000000-0000-4000-8000-000000000003', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000012', '4F1', 'e1000000-0000-4000-8000-000000000004', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000013', '4F4', 'e1000000-0000-4000-8000-000000000004', 'ACTIVE'),
  ('eb000000-0000-4000-8000-000000000014', '4F5', 'e1000000-0000-4000-8000-000000000004', 'ACTIVE')
ON CONFLICT (id) DO UPDATE
SET section_name = EXCLUDED.section_name,
    year_level_id = EXCLUDED.year_level_id,
    status = EXCLUDED.status;

-- 4. STUDENT ENROLLMENTS
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS year_level_id UUID REFERENCES year_levels(id);
ALTER TABLE student_enrollments ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES sections(id);

UPDATE student_enrollments
SET year_level_id = yl.id
FROM year_levels yl
WHERE student_enrollments.year_level_id IS NULL
  AND yl.level_number = student_enrollments.year_level;

UPDATE student_enrollments
SET section_id = s.id
FROM sections s
WHERE student_enrollments.section_id IS NULL
  AND lower(trim(s.section_name)) = lower(trim(student_enrollments.section));

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE year_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;

-- DevAdmin: full CRUD on event_categories
DROP POLICY IF EXISTS event_categories_devadmin_all ON event_categories;
CREATE POLICY event_categories_devadmin_all ON event_categories
  FOR ALL TO authenticated
  USING (get_current_user_role() = 'DEVADMIN')
  WITH CHECK (get_current_user_role() = 'DEVADMIN');

-- Officer / Student: read active event_categories
DROP POLICY IF EXISTS event_categories_read_active ON event_categories;
CREATE POLICY event_categories_read_active ON event_categories
  FOR SELECT TO authenticated
  USING (status = 'ACTIVE' OR get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

-- DevAdmin: full CRUD on year_levels
DROP POLICY IF EXISTS year_levels_devadmin_all ON year_levels;
CREATE POLICY year_levels_devadmin_all ON year_levels
  FOR ALL TO authenticated
  USING (get_current_user_role() = 'DEVADMIN')
  WITH CHECK (get_current_user_role() = 'DEVADMIN');

-- Officer / Student: read active year_levels
DROP POLICY IF EXISTS year_levels_read_active ON year_levels;
CREATE POLICY year_levels_read_active ON year_levels
  FOR SELECT TO authenticated
  USING (status = 'ACTIVE' OR get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

-- DevAdmin: full CRUD on sections
DROP POLICY IF EXISTS sections_devadmin_all ON sections;
CREATE POLICY sections_devadmin_all ON sections
  FOR ALL TO authenticated
  USING (get_current_user_role() = 'DEVADMIN')
  WITH CHECK (get_current_user_role() = 'DEVADMIN');

-- Officer / Student: read active sections
DROP POLICY IF EXISTS sections_read_active ON sections;
CREATE POLICY sections_read_active ON sections
  FOR SELECT TO authenticated
  USING (status = 'ACTIVE' OR get_current_user_role() IN ('DEVADMIN', 'OFFICER'));

-- Ensure DevAdmin-only write on academic_years and semesters
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE semesters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_years_devadmin_all ON academic_years;
CREATE POLICY academic_years_devadmin_all ON academic_years
  FOR ALL TO authenticated
  USING (get_current_user_role() = 'DEVADMIN')
  WITH CHECK (get_current_user_role() = 'DEVADMIN');

DROP POLICY IF EXISTS academic_years_read_all ON academic_years;
CREATE POLICY academic_years_read_all ON academic_years
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS semesters_devadmin_all ON semesters;
CREATE POLICY semesters_devadmin_all ON semesters
  FOR ALL TO authenticated
  USING (get_current_user_role() = 'DEVADMIN')
  WITH CHECK (get_current_user_role() = 'DEVADMIN');

DROP POLICY IF EXISTS semesters_read_all ON semesters;
CREATE POLICY semesters_read_all ON semesters
  FOR SELECT TO authenticated
  USING (true);
