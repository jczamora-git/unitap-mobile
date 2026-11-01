# UniTap 2.0 Privacy Notice
**Document Version**: 2.0.0 (DRAFT)  
**Effective Date**: November 1, 2026  
**Status**: DRAFT — Pending Institutional Review & DPO Approval  
**Applicable Law**: Republic Act No. 10173 (Philippine Data Privacy Act of 2012)

---

## 1. Introduction & Responsible Organization
UniTap ("we", "us", or "our") is an offline-first mobile application utilized by the Computer Studies Student Government ("CSG") in cooperation with `[Insert College / University Name]`. We are committed to protecting your personal information and respecting your data privacy rights under the Philippine Data Privacy Act of 2012 (Republic Act No. 10173).

- **Personal Information Controller**: `[Insert College Student Government / University Department]`
- **Data Protection Officer (DPO)**: `[Insert DPO Name / Office of Data Protection]`
- **Contact Email**: `[privacy@university.edu.ph]`
- **Official Address**: `[Insert Campus Address / Room Number]`

---

## 2. Personal Information We Collect
We collect only the minimum personal data necessary for official student organization governance, attendance tracking, and financial accountability:

1. **Student Academic Information**:
   - School ID number
   - Full name (First Name, Middle Name, Last Name)
   - Academic program / degree course, year level, and enrolled section
   - Semester enrollment history
2. **Identification & Physical Verification Data**:
   - Student portrait photograph (profile picture)
   - Physical NFC card identification number (Tag UID)
3. **Attendance & Participation Records**:
   - Event check-in timestamps and attendance status (Present, Late, Excused, Absent)
   - Visual verification indicators performed by authorized officers
   - Administrative attendance void or adjustment history with auditable reasons
4. **Financial Obligation & Payment Records**:
   - Assessed student organization contributions and official event absence fines
   - Official receipt reference numbers, timestamps, and payment channels
   - Payment reversal history with auditable justifications
5. **Account & Device Metadata**:
   - Username, encrypted password hashes, and assigned system role (DEVADMIN, OFFICER, STUDENT)
   - Device identifier and synchronization timestamps used to coordinate offline data

> [!NOTE]
> UniTap does **not** collect sensitive biometric facial recognition templates, government-issued IDs, bank account credentials, or geolocation tracking coordinates.

---

## 3. Why We Process Your Data (Purpose & Lawful Basis)
We process personal data based on legitimate academic governance and contractual relationships under Section 12 of RA 10173:

| Processing Purpose | Lawful Basis (RA 10173) | Explanation |
|---|---|---|
| **Student Identification & Quorum Verification** | Legitimate Interest & Student Org Constitution | Ensuring that only officially enrolled students participate in student government assemblies and events |
| **Attendance Tracking via NFC** | Legitimate Interest & Academic Bylaws | Rapid check-in and attendance verification for mandatory or elective organization events |
| **Visual Photo Verification** | Legitimate Interest | Allowing officers to visually confirm the card bearer's identity to prevent proxy scanning and attendance fraud |
| **Financial Obligation & Payment Administration** | Contractual Necessity (Student Membership Obligations) | Managing membership dues, assessing absence fines in accordance with student bylaws, and issuing verifiable receipts |
| **Self-Service Student Monitoring** | Contractual Necessity & Transparency | Empowering students to inspect their own attendance history, outstanding dues, and official receipts |

---

## 4. How Information is Collected
- **Officer Roster Uploads**: Student rosters may be imported by authorized student government officers using standardized CSV files derived from authorized department enrollment lists.
- **Direct Student Input**: Students provide account credentials and submit semester profile confirmations upon activating their UniTap accounts.
- **Physical NFC Card Interaction**: Timestamps and card associations are captured when an NFC card is tapped at an authorized UniTap scanner terminal.

---

## 5. Who Has Access to Your Data
Access to student records is strictly governed by Role-Based Access Control (RBAC) enforced by PostgreSQL Row-Level Security (RLS):
- **Students**: Can access **only their own** profile, attendance records, financial obligations, and payment receipts. Students cannot view other students' records or photos.
- **Officers**: Access student rosters, photo verification screens, attendance logs, and financial records strictly within their authorized administrative scope and assigned events.
- **DevAdmins / System Administrators**: Access global academic settings and technical maintenance logs. Administrators do not access personal records except for verified support requests.
- **Third-Party Service Providers**: We utilize Supabase, Inc. as our cloud hosting and database infrastructure provider. Data stored in Supabase is protected by transport encryption (TLS) and database-level access restrictions.

---

## 6. Offline Storage & Synchronization
UniTap is an offline-first mobile application. When an authorized officer scans attendance or records a payment in disconnected campus areas:
1. Records are securely written to an encrypted local SQLite database on the terminal.
2. Changes are queued in `sync_outbox`.
3. When the terminal reconnects to the internet, records synchronize bidirectionally with Supabase using monotonic transaction logs.
4. When an officer signs out of UniTap, cached operational data is securely cleared from the terminal.

---

## 7. Data Retention and Disposal
Personal data is retained only for as long as necessary to fulfill the administrative purposes outlined in this notice:
- **Academic & Enrollment Records**: Retained throughout the student's active enrollment plus one (1) academic year following graduation or transfer.
- **Financial Audit Records**: Retained for five (5) academic years in compliance with student government financial auditing and liquidation requirements.
- **Attendance Records**: Retained for four (4) academic years (the standard undergraduate cycle).
- **Disposal**: Records scheduled for disposal are permanently deleted from database tables and storage buckets using cryptographic purge methods.

---

## 8. Your Data Subject Rights Under RA 10173
As a student or data subject, you are entitled to the following statutory rights under the Data Privacy Act of 2012:
1. **Right to be Informed**: You have the right to know how your personal data is collected and processed.
2. **Right to Access**: You have the right to request access to and inspect all records associated with your student profile.
3. **Right to Rectification**: You have the right to dispute any inaccuracy or error in your records and have it corrected.
4. **Right to Erasure or Blocking**: You have the right to request the suspension, withdrawal, or removal of your personal data when processing is unauthorized or no longer necessary, subject to institutional record retention obligations.
5. **Right to Damages & Redress**: You have the right to file a complaint with our Data Protection Officer or with the National Privacy Commission (NPC) if your rights have been violated.

To exercise any of these rights, visit **Settings → Privacy & Security → Privacy & Data Requests** inside UniTap, or email our Data Protection Officer at `[privacy@university.edu.ph]`.

