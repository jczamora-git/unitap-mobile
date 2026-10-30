-- UniTap phase-1 OFFLINE-FIRST relational model / SQLite 3
-- All IDs supplied by the application as UUIDs; date-time fields UTC ISO-8601 text.
-- Amounts are INTEGER Philippine centavos, never floating point pesos.
-- Initialize SQLite connection with PRAGMA foreign_keys = ON before each session.
PRAGMA foreign_keys = ON;
BEGIN;

CREATE TABLE schema_migrations (
 version INTEGER PRIMARY KEY, description TEXT NOT NULL,
 applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO schema_migrations (version, description) VALUES (1,'UniTap phase 1 offline database');

-- 01 ACADEMIC STRUCTURE
CREATE TABLE academic_years (
 id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, -- '2026-2027'
 starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ACTIVE','ARCHIVED')),
 CHECK(starts_on < ends_on)
);
CREATE TABLE semesters (
 id TEXT PRIMARY KEY, academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
 term TEXT NOT NULL CHECK(term IN ('FIRST','SECOND','SUMMER')),
 starts_on TEXT NOT NULL, ends_on TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','ACTIVE','CLOSED')),
 UNIQUE(academic_year_id, term), CHECK(starts_on < ends_on)
);
CREATE UNIQUE INDEX only_one_active_semester ON semesters(status) WHERE status='ACTIVE';
CREATE INDEX idx_semesters_year ON semesters(academic_year_id);
CREATE TABLE programs (
 id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1))
);

-- 02 STUDENTS / HISTORICAL SEMESTER ENROLLMENTS
CREATE TABLE students (
 id TEXT PRIMARY KEY, school_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
 first_name TEXT NOT NULL, middle_name TEXT, last_name TEXT NOT NULL,
 photo_local_uri TEXT, photo_content_hash TEXT,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','GRADUATED')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
 CHECK(length(trim(school_id))>0), CHECK(length(trim(first_name))>0), CHECK(length(trim(last_name))>0)
);
CREATE TABLE student_enrollments (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
 semester_id TEXT NOT NULL REFERENCES semesters(id),
 program_id TEXT REFERENCES programs(id),
 year_level INTEGER NOT NULL CHECK(year_level BETWEEN 1 AND 8),
 section TEXT NOT NULL, enrollment_status TEXT NOT NULL DEFAULT 'ENROLLED'
   CHECK(enrollment_status IN ('ENROLLED','TRANSFERRED','DROPPED','COMPLETED')),
 first_name_snapshot TEXT NOT NULL, middle_name_snapshot TEXT, last_name_snapshot TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(student_id,semester_id), CHECK(length(trim(section))>0)
);
CREATE INDEX idx_enrollments_semester_section ON student_enrollments(semester_id,year_level,section);
CREATE TABLE profile_confirmations (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
 semester_id TEXT NOT NULL REFERENCES semesters(id),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUBMITTED','APPROVED','REJECTED')),
 snapshot_json TEXT, submitted_at TEXT, reviewed_at TEXT, reviewed_by_user_id TEXT,
 remarks TEXT, UNIQUE(student_id,semester_id)
);

-- 03 ACCOUNTS / ROLES / OFFLINE PER-DEVICE ACCESS
CREATE TABLE users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
 student_id TEXT UNIQUE REFERENCES students(id),
 account_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(account_status IN ('PENDING','ACTIVE','DISABLED')),
 created_by_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE user_credentials (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 password_hash TEXT NOT NULL, algorithm TEXT NOT NULL DEFAULT 'ARGON2ID' CHECK(algorithm IN ('ARGON2ID')),
 provisioned_at TEXT NOT NULL, last_online_verified_at TEXT
);
CREATE TABLE user_roles (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('DEVADMIN','OFFICER','STUDENT')),
 semester_id TEXT REFERENCES semesters(id),
 assigned_by_user_id TEXT REFERENCES users(id), assigned_at TEXT NOT NULL, revoked_at TEXT,
 CHECK((role='DEVADMIN' AND semester_id IS NULL) OR role IN ('OFFICER','STUDENT'))
);
CREATE UNIQUE INDEX unique_active_global_role ON user_roles(user_id,role)
 WHERE semester_id IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX unique_active_term_role ON user_roles(user_id,role,semester_id)
 WHERE semester_id IS NOT NULL AND revoked_at IS NULL;
CREATE TABLE devices (
 id TEXT PRIMARY KEY, device_name TEXT NOT NULL, device_code TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
 provisioned_by_user_id TEXT REFERENCES users(id), provisioned_at TEXT NOT NULL, last_sync_at TEXT
);
CREATE TABLE user_device_access (
 user_id TEXT NOT NULL REFERENCES users(id), device_id TEXT NOT NULL REFERENCES devices(id),
 access_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(access_status IN ('ACTIVE','REVOKED')),
 offline_allowed_until TEXT, last_unlocked_at TEXT, PRIMARY KEY(user_id,device_id)
);
CREATE TABLE activation_claims (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
 token_hash TEXT NOT NULL UNIQUE, issued_by_user_id TEXT NOT NULL REFERENCES users(id),
 expires_at TEXT NOT NULL, used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
);

-- 04 NFC CARDS (UID IDENTIFIES CARD, NOT THE PERSON)
CREATE TABLE nfc_cards (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
 uid_normalized TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE'
 CHECK(status IN ('ACTIVE','LOST','REPLACED','DEACTIVATED')),
 assigned_at TEXT NOT NULL, assigned_by_user_id TEXT REFERENCES users(id),
 revoked_at TEXT, revoked_by_user_id TEXT REFERENCES users(id), reason TEXT
);
CREATE UNIQUE INDEX one_active_uid ON nfc_cards(uid_normalized) WHERE status='ACTIVE';
CREATE UNIQUE INDEX one_active_card_student ON nfc_cards(student_id) WHERE status='ACTIVE';
CREATE INDEX idx_nfc_student ON nfc_cards(student_id);

-- 05 EVENTS, ELIGIBILITY, ATTENDANCE + EXPLICIT IDENTITY CONFIRMATION
CREATE TABLE events (
 id TEXT PRIMARY KEY, semester_id TEXT NOT NULL REFERENCES semesters(id),
 title TEXT NOT NULL, description TEXT, event_type TEXT NOT NULL DEFAULT 'OTHER',
 audience_type TEXT NOT NULL DEFAULT 'ALL' CHECK(audience_type IN ('ALL','YEAR','SECTION')),
 audience_json TEXT NOT NULL DEFAULT '{}', attendance_required INTEGER NOT NULL DEFAULT 1 CHECK(attendance_required IN (0,1)),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
 created_by_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_events_semester ON events(semester_id);
CREATE TABLE event_occurrences (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
 title TEXT NOT NULL, occurs_on TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 grace_minutes INTEGER NOT NULL DEFAULT 15 CHECK(grace_minutes>=0),
 status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','OPEN','CLOSED','CANCELLED')),
 opened_at TEXT, closed_at TEXT, updated_at TEXT NOT NULL,
 CHECK(starts_at < ends_at)
);
CREATE TABLE event_participants (
 id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id),
 student_id TEXT NOT NULL REFERENCES students(id),
 enrollment_id TEXT NOT NULL REFERENCES student_enrollments(id),
 expected INTEGER NOT NULL DEFAULT 1 CHECK(expected IN (0,1)),
 added_at TEXT NOT NULL,
 UNIQUE(occurrence_id,student_id)
);
CREATE TABLE attendance_records (
 id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id),
 student_id TEXT NOT NULL REFERENCES students(id),
 status TEXT NOT NULL CHECK(status IN ('PENDING','PRESENT','LATE','ABSENT','EXCUSED','VOID')),
 checked_in_at TEXT, method TEXT CHECK(method IN ('NFC','MANUAL')),
 identity_verified_by_user_id TEXT REFERENCES users(id),
 photo_checked INTEGER NOT NULL DEFAULT 0 CHECK(photo_checked IN (0,1)),
 voided_at TEXT, voided_by_user_id TEXT REFERENCES users(id), void_reason TEXT,
 updated_at TEXT NOT NULL, UNIQUE(occurrence_id,student_id),
 CHECK(status <> 'VOID' OR (voided_at IS NOT NULL AND length(trim(void_reason)) > 0))
);
CREATE INDEX idx_attendance_occurrence_status ON attendance_records(occurrence_id,status);
CREATE TABLE attendance_attempts (
 id TEXT PRIMARY KEY, occurrence_id TEXT NOT NULL REFERENCES event_occurrences(id),
 student_id TEXT REFERENCES students(id), card_id TEXT REFERENCES nfc_cards(id),
 uid_normalized TEXT NOT NULL, actor_user_id TEXT REFERENCES users(id), device_id TEXT REFERENCES devices(id),
 result TEXT NOT NULL CHECK(result IN ('ACCEPTED','DUPLICATE','UNKNOWN_CARD','INACTIVE_CARD','INACTIVE_STUDENT',
 'NOT_ELIGIBLE','SESSION_CLOSED','IDENTITY_REJECTED','ERROR')),
 photo_displayed INTEGER NOT NULL DEFAULT 0 CHECK(photo_displayed IN (0,1)),
 notes TEXT, occurred_at TEXT NOT NULL
);
CREATE INDEX idx_attempt_occurrence ON attendance_attempts(occurrence_id,occurred_at);
CREATE TABLE attendance_audit (
 id TEXT PRIMARY KEY, attendance_id TEXT NOT NULL REFERENCES attendance_records(id),
 action TEXT NOT NULL CHECK(action IN ('CHECK_IN','VOID','REINSTATE','EXCUSE','MARK_ABSENT','CORRECT')),
 old_status TEXT, new_status TEXT NOT NULL, actor_user_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT, created_at TEXT NOT NULL
);

-- 06 FINES + CONTRIBUTIONS, PAYMENTS, SIMULATED WALLET
CREATE TABLE obligation_rules (
 id TEXT PRIMARY KEY, semester_id TEXT NOT NULL REFERENCES semesters(id),
 name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('FINE','CONTRIBUTION')),
 trigger_type TEXT NOT NULL CHECK(trigger_type IN ('MANUAL','ABSENCE','LATE','EVENT')),
 default_amount_centavos INTEGER NOT NULL CHECK(default_amount_centavos>=0),
 due_on TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
 created_by_user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE student_obligations (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
 semester_id TEXT NOT NULL REFERENCES semesters(id),
 rule_id TEXT REFERENCES obligation_rules(id), related_occurrence_id TEXT REFERENCES event_occurrences(id),
 title TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('FINE','CONTRIBUTION')),
 amount_centavos INTEGER NOT NULL CHECK(amount_centavos>=0),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','VOID')),
 issued_by_user_id TEXT REFERENCES users(id), issued_at TEXT NOT NULL,
 voided_at TEXT, void_reason TEXT, updated_at TEXT NOT NULL,
 CHECK(status <> 'VOID' OR (voided_at IS NOT NULL AND length(trim(void_reason))>0))
);
CREATE UNIQUE INDEX unique_auto_obligation ON student_obligations(student_id,rule_id,related_occurrence_id)
 WHERE related_occurrence_id IS NOT NULL AND rule_id IS NOT NULL AND status='ACTIVE';
CREATE INDEX idx_obligations_sem_type ON student_obligations(semester_id,type,status);
CREATE TABLE obligation_adjustments (
 id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL REFERENCES student_obligations(id),
 kind TEXT NOT NULL CHECK(kind IN ('REDUCTION','ADDITION')),
 amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),
 reason TEXT NOT NULL, approved_by_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE payments (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
 semester_id TEXT NOT NULL REFERENCES semesters(id),
 reference_number TEXT NOT NULL UNIQUE, idempotency_key TEXT NOT NULL UNIQUE,
 amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),
 source TEXT NOT NULL CHECK(source IN ('SIMULATED_WALLET','CASH_RECORDED')),
 channel TEXT NOT NULL CHECK(channel IN ('NFC','MANUAL')),
 status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','REVERSED')),
 processed_by_user_id TEXT NOT NULL REFERENCES users(id), device_id TEXT REFERENCES devices(id),
 processed_at TEXT NOT NULL, reversed_at TEXT, reversed_by_user_id TEXT REFERENCES users(id),
 reversal_reason TEXT,
 CHECK(status <> 'REVERSED' OR (reversed_at IS NOT NULL AND length(trim(reversal_reason))>0))
);
CREATE INDEX idx_payments_semester ON payments(semester_id,status,processed_at);
CREATE TABLE payment_allocations (
 id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id),
 obligation_id TEXT NOT NULL REFERENCES student_obligations(id),
 amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),
 UNIQUE(payment_id,obligation_id)
);
CREATE INDEX idx_allocations_obligation ON payment_allocations(obligation_id);
CREATE TABLE simulated_wallets (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL UNIQUE REFERENCES students(id),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','FROZEN','CLOSED')),
 created_at TEXT NOT NULL
);
CREATE TABLE simulated_wallet_ledger (
 id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL REFERENCES simulated_wallets(id),
 kind TEXT NOT NULL CHECK(kind IN ('TOP_UP','PAYMENT','TOPUP_REVERSAL','PAYMENT_REVERSAL','ADJUSTMENT_CREDIT','ADJUSTMENT_DEBIT')),
 amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),
 related_payment_id TEXT REFERENCES payments(id), reference_number TEXT NOT NULL UNIQUE,
 processed_by_user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX idx_wallet_ledger_wallet ON simulated_wallet_ledger(wallet_id,created_at);

-- 07 CSV IMPORT / REPORT AUDIT
CREATE TABLE import_batches (
 id TEXT PRIMARY KEY, semester_id TEXT NOT NULL REFERENCES semesters(id),
 source_filename TEXT NOT NULL, sha256 TEXT NOT NULL,
 imported_by_user_id TEXT NOT NULL REFERENCES users(id), imported_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('VALIDATING','COMPLETED','PARTIAL','FAILED')),
 total_rows INTEGER NOT NULL DEFAULT 0, imported_rows INTEGER NOT NULL DEFAULT 0, rejected_rows INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE import_rows (
 id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES import_batches(id),
 row_number INTEGER NOT NULL, raw_json TEXT NOT NULL,
 result TEXT NOT NULL CHECK(result IN ('IMPORTED','UPDATED','REJECTED','SKIPPED')),
 student_id TEXT REFERENCES students(id), error_message TEXT,
 UNIQUE(batch_id,row_number)
);
CREATE TABLE report_exports (
 id TEXT PRIMARY KEY, semester_id TEXT NOT NULL REFERENCES semesters(id),
 report_type TEXT NOT NULL CHECK(report_type IN ('FINES','CONTRIBUTIONS','COMBINED','ATTENDANCE')),
 filters_json TEXT NOT NULL DEFAULT '{}', totals_json TEXT NOT NULL,
 local_file_uri TEXT, generated_by_user_id TEXT NOT NULL REFERENCES users(id), generated_at TEXT NOT NULL
);

-- 08 AUDIT + OUTBOX FUTURE SERVER SYNC
CREATE TABLE audit_events (
 id TEXT PRIMARY KEY, actor_user_id TEXT REFERENCES users(id), device_id TEXT REFERENCES devices(id),
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
 details_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL
);
CREATE INDEX idx_audit_entity ON audit_events(entity_type,entity_id,occurred_at);
CREATE TABLE sync_outbox (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id),
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('CREATE','UPDATE','VOID','REVOKE')),
 payload_json TEXT NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, synced_at TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
 last_error TEXT
);
CREATE INDEX idx_outbox_pending ON sync_outbox(synced_at,created_at);
CREATE TABLE sync_state (
 device_id TEXT PRIMARY KEY REFERENCES devices(id),
 server_cursor TEXT, last_push_at TEXT, last_pull_at TEXT, last_success_at TEXT
);
CREATE TABLE sync_conflicts (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
 local_payload_json TEXT NOT NULL, server_payload_json TEXT NOT NULL,
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
 detected_at TEXT NOT NULL, resolved_by_user_id TEXT REFERENCES users(id), resolved_at TEXT
);
COMMIT;
