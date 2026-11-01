export const OFFICER_MANAGEMENT_MIGRATION_SQL = `
-- UniTap 2.0 DevAdmin-Only Officer Management & Multi-Role Appointment Architecture
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS officer_appointments (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  student_id TEXT REFERENCES students(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  permission_preset TEXT NOT NULL DEFAULT 'FULL' CHECK(permission_preset IN ('ATTENDANCE','FINANCE','FULL','CUSTOM')),
  custom_permissions_json TEXT NOT NULL DEFAULT '[]',
  academic_year_id TEXT REFERENCES academic_years(id),
  semester_id TEXT REFERENCES semesters(id),
  appointment_start TEXT NOT NULL,
  appointment_end TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'ORGANIZATION' CHECK(scope_type IN ('ORGANIZATION','PROGRAM','SECTION','EVENT')),
  scope_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('ACTIVE','PENDING','SUSPENDED','REVOKED')),
  invitation_code TEXT,
  invitation_sent_at TEXT,
  assigned_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  suspended_at TEXT,
  revoked_at TEXT,
  last_activity_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_officer_appointments_user ON officer_appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_officer_appointments_student ON officer_appointments(student_id);
CREATE INDEX IF NOT EXISTS idx_officer_appointments_status ON officer_appointments(status);
CREATE INDEX IF NOT EXISTS idx_officer_appointments_term ON officer_appointments(semester_id);
`;
