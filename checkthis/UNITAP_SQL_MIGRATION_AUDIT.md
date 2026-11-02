# UniTap 2.0 — seven-file SQL migration security & correctness audit

**Review date:** 2026-11-01  
**Scope:** Seven SQL files supplied by the user, in chronological order; PostgreSQL/Supabase source-file review, **not** execution against a live database.  
**Conclusion:** **Do not run the supplied 18:30/18:40 migrations as-is.** The earlier migrations also need hardening; a valid migration history alone is not evidence of a secure/working system.

## Files examined

1. `20261031000001_unitap_initial_schema(1).sql` (439 lines)
2. `20261031120000_fines_contributions_redesign.sql` (425 lines)
3. `20261031160000_system_setup_academic_structure.sql` (213 lines)
4. `20261101000000_student_activation_and_rls.sql` (482 lines)
5. `20261101140000_officer_management.sql` (224 lines)
6. `20261101183000_batch_sync_and_type_alignments.sql` (334 lines)
7. `20261101184000_fix_sync_pull_obligation_rules.sql` (150 lines)

## Critical findings (confirmed from supplied SQL)

| ID | Severity | Evidence (file:line range) | Why it matters | Corrective direction |
|---|---|---|---|---|
| C1 | CRITICAL | 18:30:89–95 | `GRANT ALL ON ALL TABLES/SEQUENCES/ROUTINES IN SCHEMA public TO anon, authenticated` plus overly broad future grants. With RLS not enabled on many tables, client roles may read/mutate sensitive data directly. | Inventory deployed ACL and RLS, revoke unsafe broad privileges, add least-privilege grants and tested RLS; preserve necessary authorized access. |
| C2 | CRITICAL | 18:30:113–128 and 18:40:23–38 | `v_role := coalesce(v_role, 'DEVADMIN')` defaults missing/anonymous roles to administrator in `SECURITY DEFINER` pull. Both versions grant execution to anonymous calls. | **Fail closed**; no anonymous pull; enforce active identity and server-verified role and scoped record permissions. |
| C3 | CRITICAL | 18:30:227–334 | `sync_push_batch` is `SECURITY DEFINER`, exposed to `anon`/`authenticated`, with no caller authorization or ownership check. Caller-selected entity types and JSON payload can write privileged tables. | Disable this RPC pending a newly designed per-entity authorized ingest with idempotency, validation, and auditing. |
| C4 | CRITICAL | Initial:356–399 | `sync_pull_changes` returns raw `sync_change_log.payload` to any executor, without record ownership or role filters. Default PostgreSQL `PUBLIC` function EXECUTE, plus the 18:30 global GRANT ALL, may expose change log. | Disable; replace with caller-scoped change delivery and tested deletion/revocation semantics. |
| C5 | CRITICAL | 18:30:46–63 | Dynamically drops ALL foreign keys referencing `academic_years`, `programs`, or `semesters`, converts IDs to TEXT, and never recreates the dropped FKs. This weakens relational integrity. | Inventory actual deployed FKs and identifier values; design explicit data-compatible constraints and checked conversions in a separate planned migration. Do **not** reconstruct blindly. |
| C6 | HIGH/CRITICAL | Student activation:33–51 | `activate_student_account(p_auth_user_id UUID DEFAULT auth.uid())` permits caller-supplied identity to override `auth.uid()` within a `SECURITY DEFINER` function. | Remove caller-controlled ID, bind strictly to authenticated `auth.uid()`, validate actual account/claim, and lock claim during consumption. |
| C7 | HIGH | Student activation:271–338 | `officer_get_student_activation_status` checks neither authentication nor officer authorization and returns account-linking and claim/audit metadata. | Disable until explicit officer scope/role checks and minimum output are added. |
| C8 | HIGH | Initial:349–383 | `verify_and_claim_student_code` consumes a student activation claim without binding it to an authenticated account. | Disable obsolete unsafe activation RPC; keep one corrected secure activation path. |
| C9 | HIGH | 18:40:139–141 | `payment_allocations` is pulled with no student or officer scope filter (`SELECT *`). `SECURITY DEFINER` may bypass RLS. | Return only permitted allocations joined through owned/authorized payments and minimize fields. |
| C10 | HIGH | Student activation:340–439; Initial tables | RLS is not enabled in uploaded migrations for several sensitive tables, including `users`, `user_roles`, `nfc_cards`, `attendance_records`, `attendance_attempts`, `attendance_audit`, `devices`, `profile_confirmations`, and `sync_change_log`. The 18:30 broad grants worsen exposure. | Inventory all deployed tables (including later migrations not supplied), enable RLS and add tested policies for each data type before regranting access. |

## High-risk correctness/operational findings

| ID | Severity | Evidence | Finding / recommended fix |
|---|---|---|---|
| H1 | HIGH | 18:30:277–326 | Push `UPDATE` changes only `updated_at`, not the fields in `v_payload`; `CREATE ... ON CONFLICT` also only touches `updated_at`. Updates can be reported `APPLIED` without their intended values being persisted. |
| H2 | HIGH | 18:30:285–331 | No check of rows affected after UPDATE/VOID, operation/entity validation, durable idempotency receipt enforcement, or safe conflict rejection. Exception handler can mark `unique_violation` as applied; overall `success:true` even when `failed_count > 0`. |
| H3 | HIGH | Initial sync log; 18:30 push | Batch push does not append to `sync_change_log`; this is a plausible direct explanation for a subsequent `sync_pull_changes` returning `changes:[]`. Other writers may have triggers, but none are defined in the uploaded migrations. Verify the deployed DB. |
| H4 | HIGH | 18:30:133–215; 18:40:43–141 | Unordered `LIMIT p_limit` for each table with a timestamp cursor; no per-table page cursor or deterministic continuation. Once more than 500 records qualify, some changes can be missed. Several collections ignore `p_since` and re-download data repeatedly. |
| H5 | HIGH | Initial:315–330; 18:30:46–63 | `sync_change_log.record_id UUID` while academic/program/semester IDs are converted to semantic TEXT values such as `ay_2026_2027`. This prevents a consistent, universal change-log key without redesign. |
| H6 | HIGH | Initial:221–230; 18:40:4–5 | `obligation_rules` initially has no `updated_at`. The 18:40 patch adds the column (addressing error 42703) but does not define update maintenance. `coalesce(updated_at, created_at)` is redundant when `updated_at NOT NULL`. |
| H7 | HIGH | Finance redesign:288–394 | `record_obligation_payment` computes outstanding balance without locking obligations/serializing concurrent collectors. Two officers can record overlapping payments against the same balance, particularly across devices. |
| H8 | HIGH | Officer management:164–184 | Suspending an officer only changes `officer_appointments.status`; existing `user_roles` entry remains active. Existing role resolver checks `user_roles` only, not appointment status/dates/scopes. |
| H9 | HIGH | Officer management:188–219 | Revoking one appointment revokes **all** active OFFICER role rows for the user, even if another valid appointment exists. Needs coherent multi-appointment role derivation. |
| H10 | HIGH | Officer management:5–26 and 67–161 | Officer appointment stores academic/semester IDs as TEXT but `devadmin_assign_officer` accepts UUID parameters, incompatible with semantic IDs; scope_type/scope_id not validated against target; appointment start/end and user/student association not validated. |
| H11 | HIGH | Initial:48–69; 18:30:12–44 | Broad FK removal permits inconsistent academic/semester/program references; `student_enrollments` previously contained proper FKs, undermining historical enrollment accuracy. |
| H12 | HIGH | Student activation:119–156 | Claim row is not locked using `FOR UPDATE` and success update has no `used_at IS NULL` guard; possible races. `ON CONFLICT DO NOTHING` for role insertion has no matching natural uniqueness constraint shown, so repeated active roles remain possible. |
| H13 | MEDIUM/HIGH | Student activation:440–480 | Anonymous `validate_activation_code` distinguishes missing vs claimed School IDs and returns student names; no server-side rate limiting against guessing/automated checks is visible. |
| H14 | MEDIUM/HIGH | Academic structure:133–141 | Section backfill joins by section name only; where section names repeat across academic years/programs, enrollment mapping may be ambiguous or incorrectly assigned. |
| H15 | MEDIUM/HIGH | Finance redesign:174–195 | Bulk fine RPC checks officer role but not a scope/permission assignment or rule `type='FINE'`; must also ensure authorized category, semester, and event association. |
| H16 | MEDIUM | Initial:218–285 | Simulated wallet tables remain as deprecated legacy history, although the desired product no longer uses wallet semantics. Retention and access require explicit audit; do not drop data without archival approval. |
| H17 | MEDIUM | Initial:57–69 | `year_level` allows 1 through 8, though current UI/setup is 1 through 4. Avoid narrowing constraints blindly if existing institution data may require higher levels; verify requirements. |
| H18 | MEDIUM | 18:30:89–95 | Default privileges are grantor-specific; running `ALTER DEFAULT PRIVILEGES` under a different owner may not reverse historical grants. Audit `pg_default_acl` with grantor ownership. |

## Per-file verdict

| Migration | Verdict | Notes |
|---|---|---|
| 20261031000001 initial schema | **Foundational, needs hardening** | Reasonable domain tables, but RLS incomplete, unsafe activation/cursor RPCs, mutable history cascade deletion and mixed IDs. |
| 20261031120000 finance redesign | **Conceptually appropriate, needs hardening** | Direct-payment redesign and absentee fine validation align with product intent; financial concurrency and authorization still insufficient. |
| 20261031160000 system setup | **Mostly logical, review backfill** | Correct 1:M academic setup. Potential ambiguous section backfill and overly permissive general reads. |
| 20261101000000 student activation | **Not secure as-is** | Caller-controllable identity, no auth check on status RPC, claim races, and anonymous information disclosure. |
| 20261101140000 officer management | **Partially implemented, authorization inconsistent** | Multi-role concept fits, but suspended/expired appointments do not reliably suppress privileges; no scoped enforcement. |
| 20261101183000 batch sync/type alignments | **Unsafe; do not deploy unchanged** | Broad grants, blanket FK removal, impersonation-level role fallback, unsafe push, unreliable sync. |
| 20261101184000 obligation_rules sync fix | **Narrow error fix but unsafe; do not deploy unchanged** | Adds missing timestamp but reinstates dangerous privileged pull and anonymous EXECUTE. |

## Included files and intended usage

1. `READ_ONLY_DATABASE_PREFLIGHT.sql` — **Run first** in an authorized Supabase SQL Editor session. Outputs the **actual deployed** RLS, ACLs, function execution, timestamps, FKs, and change-log counts. Read-only.
2. `20261101185000_emergency_rpc_containment_REVIEW_BEFORE_APPLY.sql` — **Review before running**. This is deliberately **fail closed**: it quarantines known vulnerable synchronization and account-activation RPCs and revokes anonymous broad direct grants. As a result, sync and student activation will stop until secure replacements are available. Does **not** repair sync, restore foreign keys, correct role scope, or undo all `authenticated` broad grants. Its intent is emergency containment, not production feature completion.

**No attached original file is rewritten.** Never alter historical migrations already applied. A new tested migration, separate from emergency containment, must implement the final secure replacements and restore only necessary grants.

## Deployment order (recommended)

1. Determine from `supabase_migrations.schema_migrations` or deployment logs **which of the seven migrations actually ran**. The SQL text alone does not establish live state.
2. Back up the current database and preserve audit logs. If real student data is involved, coordinate incident assessment with the responsible school organization/DPO.
3. Run the read-only preflight and review output. Identify direct grants, `PUBLIC` function execution, RLS missing tables, and installed RPC signatures.
4. If the vulnerable endpoints are active, implement approved emergency containment promptly; expect sync/account-activation disruption and communicate it to operators.
5. In staging, develop **secure role/permission-scoped push and pull** with deterministic paging/checkpoints, server-generated changelog, properly maintained timestamps, and RLS/security tests. Design identity IDs and FKs consistently.
6. Fix account-activation identity binding/rate limiting, officer appointment authorization, financial concurrency, and backfill consistency with reviewed migrations.
7. Test student A/B isolation, anonymous access, active/expired officer accounts, DevAdmin access, >500-record synchronization, two-device offline payment conflict, and correct role-based hydration before re-enabling RPC calls.
8. Deploy staged migrations via the application's normal migration system (not manual rewriting of applied migration versions). Explicitly grant EXECUTE on **reviewed** RPCs to the minimum necessary roles.

## Validation boundaries

- Conducted: full static source review of seven supplied migration files, SQL construct/privilege scan, and comparison to official Supabase/PostgreSQL guidance.
- Not conducted: connection to live Supabase, actual SQL execution, migration ordering tests against a PostgreSQL instance, inspection of the live `pg_default_acl`, live RLS smoke tests, client code verification, or Android/device sync verification.
- Treat the included SQL as a **review artifact**, not a claim that the database is fixed. SQL statements in the containment patch must be staged/reviewed by a DB administrator before running. No production migration was executed by this review.
