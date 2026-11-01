# UniTap 2.0 Student Photo & NFC Card Privacy Policy
**Document Reference**: PRIV-POL-004  
**Status**: DRAFT — Pending Institutional Review & DPO Approval  
**Applicable Law**: RA 10173 Section 13, NPC Circular 2023-06

---

## 1. Student Portrait Photographs
- **Classification**: Student portrait images are visual personal identifiers.
- **Storage Requirement**: Photos must reside in a **private** Supabase Storage bucket (`student-photos`). Permanent public URLs are strictly prohibited.
- **Access Control**:
  - A student may upload and view their own portrait.
  - An authorized officer may view the portrait **only** during an active attendance scan verification to confirm bearer identity.
  - Officers cannot access an unrestricted photo gallery of the student body.
- **Biometric Restriction**: No biometric facial recognition algorithms, automated face matching, or biometric template extractions are performed. Identification relies strictly on visual inspection by an accountable human officer.

---

## 2. NFC Physical Card Associations
- **Card Tag UID**: The serial number (UID) of an NFC card is an electronic identifier linked to a student's `school_id`.
- **Card Registration**: Cards are bound to students in the `nfc_cards` table by authorized officers.
- **Duplicate Tap Lockout**: During event attendance and rapid payment collection, tap anti-passback and duplicate debounce protections prevent fraudulent multi-scanning.
- **Card Replacement & Revocation**: When a student reports a lost card, the existing binding is immediately marked `REVOKED`. The Tag UID cannot be used by a finder to impersonate the student.
- **Encryption Standards**: Card UID transmissions over the network are encrypted via TLS 1.3. Local storage hashes prevent plain-text dictionary extraction.

