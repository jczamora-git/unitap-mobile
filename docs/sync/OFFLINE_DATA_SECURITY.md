# Offline Data Security & Account Switching Isolation — UniTap 2.0

## 1. Threats in Offline Shared Terminal Environments

In student organizations, multiple officers or students may use the same tablet or NFC scanner terminal. Without strict isolation:
- User B could view User A's cached personal balance, fines, or attendance.
- An officer whose role was revoked could continue viewing student profiles offline.
- Pending outbox operations created by User A might be pushed under User B's authentication context.

---

## 2. Security Safeguards

### 2.1 Account Switching Isolation Protocol
1. **Hydration Identity Tracking**:
   The local database records the `hydrated_user_id` and `hydrated_role`.
2. **Account Change Detection**:
   When `SupabaseAuthService.login()` or `authService.login()` authenticates a user whose `userId` does not match the active `hydrated_user_id`:
   - If the previous user had private records (`STUDENT`), prune the previous user's private records (`students`, `student_enrollments`, `attendance_records`, `student_obligations`, `payments`).
   - Retain public organizational structure (`academic_years`, `semesters`, `programs`, `event_categories`).
   - Retain pending uncommitted `sync_outbox` operations with original `actor_user_id`.
   - Initiate scoped rehydration for the new user.
3. **Session Termination**:
   On logout:
   - Stop active `SyncManager` intervals.
   - Unsubscribe all Supabase Realtime channels.
   - Clear volatile memory session tokens and pin cache.

---

## 3. Offline Authorization Expiration

Cached authorization tokens are valid for a maximum of **7 days** without internet connection.
After 7 days of continuous offline operation:
- The terminal flags the session as `AUTH_REQUIRED`.
- NFC attendance and dues scanning are suspended until the terminal reconnects and validates role revocation status against Supabase Auth.

