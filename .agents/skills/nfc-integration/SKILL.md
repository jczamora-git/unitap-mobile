---
name: nfc-integration
description: Safe usage and preservation of native NFC plugin and tag normalizer.
---

# NFC Integration Skill

## Rules
1. **Preserve `nfc.service.ts`**: Do NOT rewrite the native scanner or duplicate its Capacitor event listener.
2. **Scanner Lifecycle**:
   - Only ONE active scan mode may run at a time (NFC Checker vs Attendance Scanner vs RFID Card Registration vs Diagnostics).
   - Always call `stopScanning()` on page leave (`onIonViewDidLeave`).
3. **Workflow Distinction**:
   - **NFC Checker (`/tabs/scan`)**: Strictly read-only card identification. Queries local student storage to inspect card lifecycle status (`ACTIVE`, `LOST`, `REPLACED`, `DEACTIVATED`, `UNREGISTERED`) and linked student profile. Never records attendance or modifies financial records.
   - **Attendance Scanner (`/events/attendance/:occurrenceId?`)**: Occurrence-specific check-in scanner under the Events workflow. Enforces eligibility, late grace period cutoffs, and records immutable attendance logs.
4. **Hardware Debounce vs Application Attendance**:
   - Native service debounces physical jitter (1500ms).
   - Application-level attendance checks for duplicate attendance across the entire occurrence duration.
5. **Tag Normalization**:
   - Always use `normalizeNfcTag()` or `formatUid()` so UIDs match canonical hex uppercase (e.g. `04:A7:32:91:BC:20:80` and `04A73291BC2080`).
