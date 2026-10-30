---
name: local-data
description: Offline-first persistence patterns using Capacitor Preferences for UniTap.
---

# Local Data Skill

## Persistence Architecture
1. **Legacy Compatibility**:
   - `nfc_inspector_students_v1`: Existing students storage key. Do not wipe or rename.
   - Backward-compatible deserialization: allow records without `studentNumber`.
2. **New Keys**:
   - `unitap_events_v1`: Events, schedules, occurrences, and participants.
   - `unitap_finance_v1`: Charge templates, student charges, wallets, transactions, payments.
   - `unitap_attendance_scans_v1`: Raw attendance scan attempt audit logs.
3. **Atomic Operations**:
   - Store finance as an integrated coherent document to prevent partial debit/credit inconsistency.
   - Handle JSON parse errors safely with graceful fallback.
4. **Sample Data**:
   - Provide non-destructive "Load Sample Data" and "Reset Demo Data" without destroying real user records.
