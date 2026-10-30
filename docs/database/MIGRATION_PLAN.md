# UniTap 2.0 Supabase & PostgreSQL Migration Plan

## 1. Scope & Execution Order

1. **Deploy PostgreSQL Initial DDL Migration**:
   - Create schema matching UniTap 2.0 entities in `supabase/migrations/20261031000001_unitap_initial_schema.sql`.
   - Setup Row Level Security (RLS) on all user-facing tables.
   - Deploy `sync_change_log`, `sync_operation_receipts`, and `sync_conflicts`.
2. **Deploy Secure RPC Functions**:
   - `verify_and_claim_student_code(p_school_id, p_code_hash)`: atomic student registration activation.
   - `sync_push_operations(p_device_id, p_operations)`: atomic outbox ingestion with idempotency check.
   - `sync_pull_changes(p_since_cursor, p_limit)`: monotonic cursor delta pull.
3. **Configure Storage Bucket**:
   - Create private storage bucket `student-photos`.
   - Setup RLS policies restricting read to authenticated users and write to officers/DevAdmins.
4. **Client Hybrid Integration**:
   - Implement Supabase Auth client in `src/integrations/supabase/`.
   - Implement synchronization services in `src/services/sync/`.
   - Update `LoginPage.vue` and create `RegisterPage.vue`, `InitialSyncPage.vue`, and `SyncStatusPage.vue`.
