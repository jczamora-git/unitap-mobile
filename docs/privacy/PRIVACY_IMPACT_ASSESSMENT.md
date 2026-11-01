# UniTap 2.0 Privacy Impact Assessment (PIA)
**Document Reference**: PRIV-PIA-2026-V1  
**Status**: DRAFT — Pending Institutional Review & DPO Approval  
**Methodology**: National Privacy Commission (NPC) Circular 2016-01 & 2023-06 Guidelines

---

## 1. Project Background & Architecture Overview
UniTap 2.0 is an offline-first mobile application designed for student government attendance tracking, student record management, and financial obligation collections (contributions and fines). It operates as a hybrid architecture:
- **Cloud Master**: Supabase (PostgreSQL, Supabase Auth, Storage)
- **Local Client**: Android Capacitor container with local SQLite database (sql.js / Native SQLite)
- **Data Flow**: Offline-first local writes enqueue to `sync_outbox`, synchronizing bidirectionally with Supabase upon connectivity.

---

## 2. Threat Analysis & Risk Matrix

| Threat Description | Vulnerability | Likelihood | Impact | Overall Risk | Existing / Implemented Safeguards | Proposed Additional Safeguards |
|---|---|---|---|---|---|---|
| **Unauthorized student record enumeration** | Missing or overly permissive RLS on Supabase PostgreSQL | Medium | High | **High** | Role-scoping logic in application layer | Supabase Row-Level Security (RLS) policies enforcing `auth.uid()` and verified role table checks |
| **Exposure of Student Profile Photos** | Public Supabase Storage bucket URLs | High | High | **High** | Images loaded via URI strings | Restrict bucket to PRIVATE; generate time-limited signed URLs (max 15 mins); restrict upload to authorized officers/students |
| **Offline data exposure on lost/stolen device** | Stored unencrypted SQLite database on Android device | Medium | High | **Medium-High** | Android OS application sandboxing (`com.unitap.app`) | Scope offline SQLite caches strictly to assigned operational roles; provide instant session wipe on sign-out; review SQLCipher encryption |
| **Student proxy scanning (Attendance fraud)** | Student taps another student's NFC card | High | Medium | **Medium** | Visual photo verification workflow in `AttendanceScanPage.vue` (`photo_checked` flag) | Audit logging of photo verification; mandatory officer confirmation before tap finalization |
| **CSV Import without student notification** | Officers uploading rosters before students register | High | Medium | **Medium** | Formula-injection sanitization (`=`, `+`, `-`, `@`) | Mandatory officer-facing privacy acknowledgment prior to CSV commit; institutionally approved notice verification |
| **Financial record tampering or balance inflation** | Floating point math or client-side wallet manipulation | Low | High | **Medium** | Strict integer centavo arithmetic (`₱1.00 = 100`); immutable ledger allocations | Server-side allocation verification trigger; reversal audit tracking |
| **Unauthorized access by revoked officer** | Stale offline JWT token or cached permissions | Low | High | **Medium** | Monotonic pull sync; 7-day token cache lifetime | Device deauthorization trigger in Supabase; immediate cache invalidation on server-side role revocation |

---

## 3. Recommended Remediation Roadmap
1. **Immediate (Pre-Production)**:
   - Apply Supabase RLS migration hardening all personal data tables.
   - Enforce private storage rules on student portrait bucket.
   - Implement versioned privacy notice review and acknowledgment dialog in the welcome sequence.
   - Deploy officer CSV import privacy notice and attestation checkbox.
2. **Short-Term (Institutional Deployment)**:
   - Finalize institutional DPO designation and contact details in all draft documents.
   - Implement automatic cache clearing of sensitive student data upon user sign-out.
3. **Continuous Compliance**:
   - Annual Privacy Impact Assessment review.
   - Regular security testing and audit log reviews for unauthorized record export or attendance adjustments.

