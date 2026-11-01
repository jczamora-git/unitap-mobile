# UniTap 2.0 Role-Based Access Control (RBAC) Policy
**Document Reference**: PRIV-POL-003  
**Status**: DRAFT — Pending Institutional Review & DPO Approval  
**Applicable Law**: NPC Circular 2023-06 (Security of Personal Data)

---

## 1. Role Hierarchy and Principle of Least Privilege
UniTap enforces the Principle of Least Privilege across all storage layers. Users are granted only the access rights required for their specific responsibilities.

### Role Definitions:
1. **DEVADMIN (System Administrator)**:
   - Primary duty: Academic setup (Academic Years, Semesters, Programs, Year Levels, Sections, Event Categories, Officer assignments).
   - Restriction: DEVADMIN has no legitimate administrative need to browse student personal financial records or private photos except when investigating verified technical defects.
2. **OFFICER (Student Government Representative)**:
   - Primary duty: Conducting attendance scans, viewing absentees, issuing authorized fine/contribution dues, and recording payments.
   - Restriction: Officer access is limited to students, events, and sessions within their assigned academic semester or event scope. Bulk exports are monitored.
3. **STUDENT (Enrolled Undergraduate)**:
   - Primary duty: Self-service inspection of own academic status, attendance records, assigned obligations, and digital receipts.
   - Restriction: Students may **never** view or query records, photos, attendance, or financial balances belonging to other students.

---

## 2. Enforcement Mechanisms
- **PostgreSQL Row-Level Security (RLS)**: Enforces access rules directly at the database engine using `auth.uid()` and verified role queries from `user_roles`. Client-supplied headers, local variables, or editable metadata are never trusted.
- **SQLite Scoped Hydration**: Initial sync (`initial-sync.service.ts`) scopes records down to the authenticated user. A student device never downloads the global student body database.
- **Supabase Storage Policies**: Private storage buckets check object ownership and officer scan session context before issuing signed download URLs.

