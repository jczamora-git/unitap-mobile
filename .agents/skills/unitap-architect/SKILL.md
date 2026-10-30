---
name: unitap-architect
description: Architectural guidelines for UniTap domain models, service boundaries, and state flow.
---

# UniTap Architect Skill

## Principles
1. **Domain Isolation**:
   - `StudentService`: Manages student profiles, RFID assignments, and card history.
   - `EventService`: Manages events, occurrences, and expected participant rosters.
   - `AttendanceService`: Evaluates scans against active occurrences, registers check-ins, logs attempts.
   - `FinanceService`: Manages charge templates, student charges, simulated wallets, ledger transactions, and payments.
2. **Local Persistence Repositories**:
   - Provide concrete repositories using `@capacitor/preferences` with localStorage fallback.
   - Structure domain storage with clear schemas: `students_v1`, `unitap_events_v1`, `unitap_finance_v1`.
3. **Reactive Refresh**:
   - Services emit lightweight event bus / callback / reactive state triggers when data changes so dashboards and lists auto-refresh.
