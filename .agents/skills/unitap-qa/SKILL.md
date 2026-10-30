---
name: unitap-qa
description: Quality assurance and automated testing specifications for UniTap.
---

# UniTap QA Skill

## Verification Checklist
1. **Attendance Invariants**:
   - Only 1 accepted attendance record per student per occurrence.
   - Unregistered tag returns `UNREGISTERED`.
   - Ineligible student returns `NOT_ELIGIBLE`.
   - Closed occurrence rejects scans (`SESSION_CLOSED`).
   - Closing occurrence converts `PENDING` -> `ABSENT` while preserving `PRESENT`, `LATE`, and `EXCUSED`.
2. **Financial Invariants**:
   - All monetary amounts stored as integer centavos.
   - Wallet cannot drop below 0.
   - Payments must allocate exact amounts (`sum(allocations) === payment.amount`).
   - Cannot pay `VOID` or already `PAID` charges.
   - Transactions are immutable ledger records.
3. **Automated Unit Testing**:
   - Vitest suite covers StudentService, EventService, AttendanceService, FinanceService, and Storage.
