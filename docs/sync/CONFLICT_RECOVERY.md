# Conflict Detection & Reconciliation Rules — UniTap 2.0

## 1. Conflict Scenarios in Offline Campus Operations

| Entity | Offline Action | Cloud State at Sync Time | Conflict Classification | Resolution Policy |
|---|---|---|---|---|
| Attendance Record | Officer scans card for Event A (IN) | Card was already checked in on Terminal 2 | Duplicate / Unique Constraint (23505) | **SERVER_WINS** (Audit collision in `sync_conflicts`, resolve outbox) |
| Attendance Record | Officer marks absent/void offline | Cloud record already finalized | State Divergence | **SERVER_WINS** with officer notification |
| Student Obligation | Fine created offline | Obligation rule revoked on cloud | Revocation Collision | **FLAGGED FOR REVIEW** (`sync_conflicts.status = 'OPEN'`) |
| Payment | Cash collected offline | Wallet balance insufficient or obligation settled | Financial Overpayment | **FLAGGED FOR AUDIT** (Provisional payment marked `NEEDS_ATTENTION`) |

---

## 2. Financial Safety Invariants

1. **Integer Centavos**: All financial amounts are integer centavos (`₱100.00 = 10000`).
2. **Never Overwrite Without Audit**: Financial conflicts NEVER silently overwrite using last-write-wins.
3. **Provisional State**: Offline payments maintain `status = 'POSTED'` locally with `synced_at = null`. In UI, they display as *"Waiting to Sync"*. Only when Supabase confirms does the receipt mark *"Synced"*.
4. **Idempotency Keys**: Every payment carries a unique UUID `idempotency_key`. Retrying a network request cannot create a duplicate payment record on the server.

