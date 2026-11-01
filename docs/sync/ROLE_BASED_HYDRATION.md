# Role-Based Data Hydration Specification — UniTap 2.0

## 1. Principle of Data Minimization (RA 10173 Compliance)

In strict adherence to the **Data Privacy Act of 2012** (RA 10173, Section 11) and the Principle of Data Minimization, **no UniTap device shall download or store local copies of personal data beyond what is strictly necessary to fulfill the user's authenticated duties**.

---

## 2. Data Scope Matrix

### 2.1 STUDENT SCOPE (Self-Contained Personal Portal)
Students require access only to their own academic status, attendance verification, obligations, and public institutional schedules.

| Table Name | Hydration Rule & Filter | Restriction |
|---|---|---|
| `academic_years` | Global active + historical labels | Permitted (Public) |
| `semesters` | Active and past registered semesters | Permitted (Public) |
| `programs` | Reference program catalog | Permitted (Public) |
| `year_levels` | Reference year catalog | Permitted (Public) |
| `sections` | Reference section catalog | Permitted (Public) |
| `event_categories` | Event category definitions | Permitted (Public) |
| `events` | Status != 'ARCHIVED', visible to student's program/year | Permitted |
| `event_occurrences` | Occurrences belonging to visible events | Permitted |
| `event_participants` | Filter: `.eq('student_id', studentId)` | Own attendance only |
| `students` | Filter: `.eq('id', studentId)` | **Only own profile**. Never roster. |
| `student_enrollments` | Filter: `.eq('student_id', studentId)` | Own semester enrollments |
| `attendance_records` | Filter: `.eq('student_id', studentId)` | Own scan check-ins/outs |
| `student_obligations` | Filter: `.eq('student_id', studentId)` | Own fines & contributions |
| `payments` | Filter: `.eq('student_id', studentId)` | Own official receipts |
| `payment_allocations` | Filter: `payment_id in (student's payment IDs)` | Own payment breakdown |
| `nfc_cards` | Filter: `.eq('student_id', studentId)` | Own assigned physical tag |

**Strict Exclusions for Students:**
- ZERO access to other students' names, school IDs, or photo storage URIs.
- ZERO access to `obligation_rules` admin templates or officer audit tables (`audit_events`, `attendance_audit`).
- ZERO access to `import_batches` or CSV raw staging records.

---

### 2.2 OFFICER SCOPE (Operational Administration)
Officers conduct live NFC card scanning, absentee monitoring, and dues collection for their designated organizational term.

| Table Name | Hydration Rule & Filter |
|---|---|
| Academic Structure | Full active academic years, semesters, programs, sections |
| Event Catalog | Active semester events, occurrences, and participant rosters |
| Students & Enrollments | Students currently enrolled in the active semester |
| NFC Cards | Active physical cards for instant tag tap identification |
| Attendance Records | Active semester occurrence check-ins |
| Obligations & Rules | Active semester fine and contribution rules and student obligation items |
| Payments & Receipts | Transactions processed within the active semester |

**Strict Exclusions for Officers:**
- System-wide administrative settings (`sync_conflicts` from other devices, DevAdmin credential setup).
- Raw cryptographic salts or authentication credentials.
- Student records from expired, non-operational academic years.

---

### 2.3 DEVADMIN SCOPE (System Configuration & Structural Audit)
DevAdmin provisions organizational structure and manages technical integrity.

| Category | Hydrated Scope |
|---|---|
| Structural | All academic years, semesters, programs, sections, and event categories |
| Security | Role assignments, officer registrations, and device terminal mappings |
| Operational Summary | Aggregate financial statistics and attendance reports |
| Conflict Management | Open and resolved sync collisions (`sync_conflicts`) |

---

## 3. Server-Side Enforcement (Supabase RLS)

Client-side filters are necessary for offline efficiency, but **PostgreSQL Row-Level Security (RLS) is the authoritative gatekeeper**.

1. **`students` table**:
   ```sql
   CREATE POLICY "Students view own profile" ON students
     FOR SELECT USING (
       auth.uid() IN (SELECT user_id FROM user_roles WHERE role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
       OR id = (SELECT student_id FROM users WHERE id = auth.uid())
     );
   ```

2. **`student_obligations` & `payments`**:
   ```sql
   CREATE POLICY "Students view own obligations" ON student_obligations
     FOR SELECT USING (
       auth.uid() IN (SELECT user_id FROM user_roles WHERE role IN ('DEVADMIN', 'OFFICER') AND revoked_at IS NULL)
       OR student_id = (SELECT student_id FROM users WHERE id = auth.uid())
     );
   ```

