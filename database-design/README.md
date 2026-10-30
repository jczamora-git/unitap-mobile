# UniTap 2.0 — phase-1 design package

Designed specifically for the provided UniTap Vue/Ionic/Capacitor project.

## Contents
- `01_unitap_offline_schema.sql`: SQLite 3 schema (34 tables + constraints/indexes)
- `02_reports_queries.sql`: semester-scoped student and category fines/contributions report queries
- `03_database_architecture_and_rollout.md`: ER diagram, roles, offline-first strategy, identity/attendance, security, CSV and migration plan
- `04_auth_ui_prototype.html`: offline-openable HTML/CSS prototype for login, student activation, and officer photo confirmation; **not a working auth backend**
- `05_schema_smoke_test.py`: SQLite schema and reporting regression smoke test
- `student_import_template.csv`: header-only CSV template, exactly six requested fields
- `student_import_example.csv`: fictional test examples (not actual student records)
- `unitap_schema_blank.sqlite3`: empty initialized SQLite database (no accounts, students or demo data)

## CSV format
`school_id,first_name,middle_name,lastname,year,section`

Select the destination academic year/semester and program in the import interface; do not add those columns to this template. All school IDs are text; keep leading zeros. `lastname` CSV maps to `students.last_name` in the database.

## Quick validation
```bash
python 05_schema_smoke_test.py
```

## How to open preview
Double-click `04_auth_ui_prototype.html` in any browser. Navigation and form previews are interactive **UI demos only**. They do not authenticate or write data.

## Integration direction
1. Make backups of the old Capacitor Preferences records (students/events/finance).
2. Add a tested Capacitor 8 SQLite adapter, encrypted DB key handling, migrations and web preview adapter.
3. Add repository implementations and migrate existing stored data.
4. Implement local authentication and role guards.
5. Implement semester/profile workflows and CSV import.
6. Implement officer-confirmed NFC identity verification and reversible attendance.
7. Implement typed fines and contributions, atomic payments, and reports.
8. Implement eventual cloud sync **after** local workflows are validated.

**Not done here:** modifying the current production app, registering real users, migrating live data, integrating SQLite plugin into the Android build, enabling online syncing, or verifying NFC hardware. These files are phase-1 **design and validation assets**.
