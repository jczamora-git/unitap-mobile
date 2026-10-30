# UniTap 2.0 Bidirectional Synchronization Protocol

## 1. Overview

UniTap uses a **Transactional Outbox** for uplink changes (SQLite $\rightarrow$ Supabase) and a **Monotonic Change Cursor** for downlink changes (Supabase $\rightarrow$ SQLite).

---

## 2. Direction A: SQLite → Supabase (Push Sync)

```text
  Local Action (e.g. Officer Confirms Attendance)
                     │
                     ▼
  ┌──────────────────────────────────────────────────┐
  │ SQLite Atomic Transaction                        │
  │ 1. INSERT INTO attendance_records (...)          │
  │ 2. INSERT INTO attendance_attempts (...)         │
  │ 3. INSERT INTO sync_outbox (                     │
  │      id, entity_type, entity_id, operation,      │
  │      payload_json, idempotency_key, created_at   │
  │    ) VALUES (...)                                │
  └──────────────────────────────────────────────────┘
                     │
                     ▼
              Outbox Processor
         (Checks Network & Triggers)
                     │
            Online? ─┴─► Yes
                     │
                     ▼
  Call Supabase RPC: `sync_push_operations(batches)`
                     │
      ┌──────────────┴──────────────┐
      ▼                             ▼
[Server Success]              [Server Conflict]
Delete / Mark Synced          Log to `sync_conflicts`
in `sync_outbox`              Apply Resolution Policy
```

### Key Guarantees:
- **Atomicity**: The outbox entry is written in the exact same SQLite transaction as the data change. If the app crashes immediately, the outbox record is intact.
- **Idempotency**: Every operation carries a unique `idempotency_key`. The server tracks processed receipts in `sync_operation_receipts`. Duplicate deliveries are acknowledged without re-applying mutations.

---

## 3. Direction B: Supabase → SQLite (Pull Sync)

1. **Trigger**:
   - Supabase Realtime broadcast notification received.
   - App resumed from background.
   - Periodic background reconciliation timer (every 5 minutes while online).
   - User triggers manual "Sync Now".
2. **Protocol**:
   - Client sends its current `last_sync_cursor` to Supabase RPC `sync_pull_changes(since_cursor, limit)`.
   - Server returns an ordered list of changes with higher cursors:
     ```json
     {
       "next_cursor": 1042,
       "has_more": false,
       "changes": [
         { "cursor": 1041, "table": "attendance_records", "op": "INSERT", "data": { ... } },
         { "cursor": 1042, "table": "payments", "op": "INSERT", "data": { ... } }
       ]
     }
     ```
   - Client applies changes inside a local SQLite transaction.
   - Client updates `sync_state.last_sync_cursor = 1042`.

---

## 4. Realtime Integration

- The app connects to Supabase Realtime channel `unitap-live-sync`.
- Realtime messages serve as **wake-up triggers**: they do NOT bypass the change log.
- Upon receiving a Realtime event, the client schedules an incremental pull sync to retrieve the exact server-validated changes.
