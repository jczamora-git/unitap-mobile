# Automatic and Manual Sync Modes — UniTap 2.0

## 1. Overview

To balance reliable cloud consistency against battery and cellular data constraints on mobile devices, UniTap 2.0 provides two synchronization modes configured per user in **Settings → Offline & Sync**:

1. **Automatic Sync** (Default)
2. **Manual Sync**

---

## 2. Mode Behavior Matrix

| Trigger / Action | Automatic Sync | Manual Sync |
|---|---|---|
| Application Startup | Runs initial reconcile if online | Validates session & local cache only |
| Periodic Polling | Runs every 60 seconds (with jitter) | **Disabled** |
| Internet Reconnection (`online` event) | Automatically triggers catch-up sync | Displays "Waiting to Sync" indicator |
| Foreground Resume (`appStateChange`) | Runs catch-up sync | Displays pending status |
| New Offline Mutation Enqueued | Enqueues in `sync_outbox` + attempts push | Enqueues in `sync_outbox` (held offline) |
| Supabase Realtime Change Event | Debounced (3000ms) scoped pull | **Ignored** (no auto-pull) |
| Manual "Sync Now" Button | Immediate push & pull | Immediate push & pull |
| Mandatory Security & Revocation Check | Always enforced | Always enforced |

---

## 3. Implementation Architecture

### 3.1 Preference Persistence
- Stored via `@capacitor/preferences` with key: `unitap_sync_mode_${userId}`.
- Defaults to `'AUTOMATIC'`.
- Independent per user account: switching accounts loads the incoming user's preference.

### 3.2 Debouncing & Concurrency Guard
- `SyncManager.syncNow()` uses an internal `isRunning` mutex.
- If a sync is already executing, concurrent calls return immediately rather than queuing duplicate network requests.
- Realtime events are debounced with a 3-second window to prevent rapid-fire requests during batch attendance scans.

### 3.3 Offline Outbox Safety in Manual Mode
- When in Manual Mode, records written to `sync_outbox` remain safely staged in SQLite.
- The UI displays **Waiting to Sync (X)**.
- Offline payments and attendance records are never lost or purged.
- When the user taps **Sync Now**, all pending outbox records are sent in chronological sequence (`created_at ASC`).

