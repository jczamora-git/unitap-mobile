# UniTap 2.0 Schema Mapping (PostgreSQL ↔ SQLite)

This document establishes the bidirectional mapping between the central Supabase PostgreSQL schema and the device-local SQLite 3 schema.

---

## 1. Type Mappings

| PostgreSQL Type | SQLite 3 Type | Serialization / Conversion Rule |
| :--- | :--- | :--- |
| `UUID` | `TEXT` | Standard 36-char lowercase hyphenated UUID format (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`) |
| `TIMESTAMPTZ` | `TEXT` | UTC ISO-8601 string (`YYYY-MM-DDTHH:mm:ss.sssZ`) |
| `DATE` | `TEXT` | ISO-8601 date string (`YYYY-MM-DD`) |
| `BIGINT` (Money) | `INTEGER` | Integer Philippine centavos (1 PHP = 100 centavos). Example: ₱150.00 = `15000` |
| `BOOLEAN` | `INTEGER` | `0` = FALSE, `1` = TRUE |
| `JSONB` | `TEXT` | Stringified JSON with `json_valid()` SQLite check constraint |
| `VARCHAR(n)` / `TEXT` | `TEXT` | UTF-8 encoded string |

---

## 2. Table Mappings & Key Entities

### 2.1 Academic Entities
- **PostgreSQL**: `academic_years(id UUID PK, label TEXT, starts_on DATE, ends_on DATE, status VARCHAR)`
  - **SQLite**: `academic_years(id TEXT PRIMARY KEY, label TEXT, starts_on TEXT, ends_on TEXT, status TEXT)`
- **PostgreSQL**: `semesters(id UUID PK, academic_year_id UUID FK, term VARCHAR, starts_on DATE, ends_on DATE, status VARCHAR)`
  - **SQLite**: `semesters(id TEXT PRIMARY KEY, academic_year_id TEXT, term TEXT, starts_on TEXT, ends_on TEXT, status TEXT)`
  - **Partial Index**: `CREATE UNIQUE INDEX only_one_active_semester ON semesters(status) WHERE status = 'ACTIVE';`

### 2.2 Student & Enrollment Entities
- **PostgreSQL**: `students(id UUID PK, school_id VARCHAR UNIQUE, first_name TEXT, middle_name TEXT, last_name TEXT, photo_storage_path TEXT, status VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`
  - **SQLite**: `students(id TEXT PRIMARY KEY, school_id TEXT UNIQUE, first_name TEXT, middle_name TEXT, last_name TEXT, photo_local_uri TEXT, status TEXT, created_at TEXT, updated_at TEXT)`
  - *Mapping note*: `photo_storage_path` in cloud maps to `photo_local_uri` on device after the image is downloaded into app-private storage.
- **PostgreSQL**: `student_enrollments(id UUID PK, student_id UUID FK, semester_id UUID FK, program_id UUID FK, year_level INT, section TEXT, enrollment_status VARCHAR, first_name_snapshot TEXT, last_name_snapshot TEXT, updated_at TIMESTAMPTZ)`
  - **SQLite**: `student_enrollments(id TEXT PRIMARY KEY, student_id TEXT, semester_id TEXT, program_id TEXT, year_level INT, section TEXT, enrollment_status TEXT, first_name_snapshot TEXT, last_name_snapshot TEXT, updated_at TEXT)`

### 2.3 Identity, Auth & NFC
- **PostgreSQL**: `users(id UUID PK REFERENCES auth.users(id), username TEXT UNIQUE, student_id UUID REFERENCES students(id), account_status VARCHAR, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`
  - **SQLite**: `users(id TEXT PRIMARY KEY, username TEXT UNIQUE, student_id TEXT, account_status TEXT, created_at TEXT, updated_at TEXT)`
- **PostgreSQL**: `user_roles(id UUID PK, user_id UUID FK, role VARCHAR, semester_id UUID FK, assigned_at TIMESTAMPTZ)`
  - **SQLite**: `user_roles(id TEXT PRIMARY KEY, user_id TEXT, role TEXT, semester_id TEXT, assigned_at TEXT)`
- **PostgreSQL**: `nfc_cards(id UUID PK, student_id UUID FK, uid_normalized VARCHAR, status VARCHAR, assigned_at TIMESTAMPTZ)`
  - **SQLite**: `nfc_cards(id TEXT PRIMARY KEY, student_id TEXT, uid_normalized TEXT, status TEXT, assigned_at TEXT)`
  - **Unique Active Constraint**: `CREATE UNIQUE INDEX uq_nfc_active_uid ON nfc_cards(uid_normalized) WHERE status = 'ACTIVE';`

### 2.4 Events & Attendance
- **PostgreSQL**: `events` & `event_occurrences`
  - **SQLite**: Identical schema with ISO-8601 timestamps.
- **PostgreSQL**: `attendance_records(id UUID PK, occurrence_id UUID FK, student_id UUID FK, status VARCHAR, checked_in_at TIMESTAMPTZ, method VARCHAR, photo_checked BOOLEAN, identity_verified_by_user_id UUID FK)`
  - **SQLite**: `attendance_records(id TEXT PRIMARY KEY, occurrence_id TEXT, student_id TEXT, status TEXT, checked_in_at TEXT, method TEXT, photo_checked INT, identity_verified_by_user_id TEXT)`
- **PostgreSQL**: `attendance_attempts(id UUID PK, occurrence_id UUID, card_uid TEXT, student_id UUID, actor_user_id UUID, result VARCHAR, reason TEXT, attempted_at TIMESTAMPTZ)`
  - **SQLite**: Matches 1:1 for fraud monitoring and wrong-person rejection auditing.

### 2.5 Finances & Ledger
- **PostgreSQL**: `obligation_rules(id UUID PK, semester_id UUID FK, name TEXT, type VARCHAR, default_amount_centavos BIGINT)`
  - **SQLite**: `obligation_rules(id TEXT PRIMARY KEY, semester_id TEXT, name TEXT, type TEXT, default_amount_centavos INT)`
- **PostgreSQL**: `student_obligations(id UUID PK, student_id UUID FK, semester_id UUID FK, rule_id UUID FK, title TEXT, type VARCHAR, amount_centavos BIGINT, status VARCHAR)`
  - **SQLite**: Matches 1:1 with integer centavos.
- **PostgreSQL**: `payments(id UUID PK, student_id UUID FK, semester_id UUID FK, reference_number TEXT, idempotency_key TEXT UNIQUE, amount_centavos BIGINT, source VARCHAR, status VARCHAR, processed_by_user_id UUID FK)`
  - **SQLite**: Matches 1:1.
- **PostgreSQL**: `simulated_wallet_ledger(id UUID PK, wallet_id UUID FK, kind VARCHAR, amount_centavos BIGINT, related_payment_id UUID, reference_number TEXT, processed_by_user_id UUID, created_at TIMESTAMPTZ)`
  - **SQLite**: Matches 1:1.
