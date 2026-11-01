# UniTap 2.0 Personal Data Processing Inventory
**Document Reference**: PRIV-INV-2026-V1  
**Status**: DRAFT — Pending Institutional Review & DPO Approval  
**Applicable Legal Framework**: Republic Act No. 10173 (Data Privacy Act of 2012), IRR, NPC Circular 2023-06

---

## 1. Controller & Governance Context
- **Personal Information Controller (PIC)**: The School / University Computer Studies Student Government (CSG) in partnership with College Administration.
  - *Institutional Placeholder*: `[Insert Authorized University Name / Department]`
  - *DPO Contact Placeholder*: `[dpo@university.edu.ph / Data Protection Officer]`
- **Personal Information Processor (PIP)**: Supabase, Inc. (Cloud Database & Authentication Infrastructure hosting PostgreSQL and Storage).
- **Application Environment**: UniTap 2.0 (Ionic Vue 9, Capacitor 8 Android container, Local SQLite on WebAssembly/Native, Offline-first synchronization).

---

## 2. Personal Data Inventory Matrix

| Data Category | Specific Elements | Purpose of Collection | Lawful Basis (RA 10173) | Source | Authorized Roles | Storage Location | Retention Schedule | Security Controls |
|---|---|---|---|---|---|---|---|---|
| **Student Identity & Academics** | School ID, First Name, Middle Name, Last Name, Program, Year Level, Section | Student identification, enrollment verification, event eligibility | Contractual necessity & Legitimate interest (Administering student organization obligations) | Officer CSV Import / Registrar Roster | DEVADMIN, OFFICER, STUDENT (own data only) | Local SQLite (`students`, `student_enrollments`), Supabase PostgreSQL | Academic tenure + 1 year post-graduation | RLS authorization, parameterized queries, formula-injection sanitization |
| **Profile Photos** | Student portrait image file, storage path, content hash | Visual identity confirmation during NFC attendance card scanning | Legitimate interest (Preventing attendance card proxy / fraud) | Student self-upload / CSV batch upload | OFFICER (during attendance scan), STUDENT (own photo) | Supabase Private Storage (`student-photos`), SQLite local file cache | Duration of student enrollment | Private bucket, time-limited signed URLs, no public bucket access |
| **NFC Card Identifiers** | Physical NFC Tag UID, card issuance status, assignment timestamps | Contactless identity verification for attendance and payment collection | Legitimate interest (Fast campus check-in) | Native NFC Card Tap via Officer | OFFICER, DEVADMIN, STUDENT (own card) | SQLite (`nfc_cards`), Supabase PostgreSQL | Academic tenure; invalidated upon card replacement | Tag UID normalizer, duplicate tap lockout, cryptographic Argon2id claims |
| **Attendance & Absences** | Event occurrence ID, check-in timestamp, late status, photo verification flag, void audit reason | Tracking event participation, verifying quorum, assessing absentee penalties | Legitimate interest & Student Government Bylaws | Officer Scanner Terminal | OFFICER, DEVADMIN, STUDENT (own records) | SQLite (`attendance_records`, `attendance_audit`), Supabase PostgreSQL | 4 years (standard academic cycle) | Immutable audit trails, void reason mandatory, tamper-evident audit table |
| **Financial Obligations & Payments** | Fine title, contribution title, amount (integer centavos), status, payment receipt reference, timestamp | Managing membership dues, transparent financial auditing, clearing accounts | Contractual necessity & Student Org Constitution | Officer Assessment / Manual Cashiering / NFC Collection | OFFICER, DEVADMIN, STUDENT (own records) | SQLite (`student_obligations`, `payments`, `payment_allocations`), Supabase PostgreSQL | 5 years (audit and accounting standards) | Integer centavo arithmetic, atomic transactions, immutable allocation ledger |
| **Officer & User Credentials** | Email, username, hashed password, assigned role, session tokens | System authentication, role-based access control (RBAC), audit accountability | Legal obligation & Security necessity | User Registration / Supabase Auth | System Auth & Respective Account Owner | Supabase Auth (`auth.users`), SQLite (`users`, `user_roles`) | Duration of account active status | Argon2id / bcrypt cryptographic hashing, JWT with 7-day offline cached validity |
| **Device Identifiers** | Device ID (`dev_default`), terminal name, device code, sync timestamps | Device provisioning, sync conflict resolution, offline queue tracking | Security necessity (Detecting unauthorized sync agents) | Client Hardware Provisioning | DEVADMIN, System Sync Engine | SQLite (`devices`, `sync_state`), Supabase PostgreSQL | Duration of device provisioning | Non-hardware MAC, ephemeral monotonic sync cursor, device authorization |
| **Privacy & Consent Metadata** | Policy version, timestamp, action type (acknowledged/consented), consent withdrawal status | Demonstrating accountability and compliance under RA 10173 | Legal obligation (RA 10173 Section 12) | User interaction | System Compliance Engine, DPO | SQLite (`privacy_notice_acknowledgments`, `privacy_consents`), Supabase PostgreSQL | Permanent compliance record | Read-only compliance log, non-deceptive opt-in, audit verification |

---

## 3. High-Risk Processing Determinations & Safeguards
1. **Student Photos**: Profile images are visual personal identifiers. Photos MUST be stored in a private Supabase Storage bucket. Access is restricted strictly to identity confirmation during live attendance scanning or student self-service viewing. Biometric facial recognition templates are **not** generated or extracted.
2. **NFC Card UID**: Tag UIDs are hardware identifiers tied to specific student identities. They are never transmitted over unencrypted channels and are checked against authorized active card bindings in SQLite/Supabase.
3. **Financial Records**: All payment amounts are represented strictly in integer centavos to eliminate rounding leakage. Payment records are immutable; corrections require an explicit reversal audit trail.

