export const FINES_REDESIGN_MIGRATION_SQL = `
PRAGMA foreign_keys = OFF;

-- 1. Update event_participants with attendance_required and excuse audit fields
ALTER TABLE event_participants ADD COLUMN attendance_required INTEGER NOT NULL DEFAULT 1 CHECK(attendance_required IN (0,1));
ALTER TABLE event_participants ADD COLUMN excused INTEGER NOT NULL DEFAULT 0 CHECK(excused IN (0,1));
ALTER TABLE event_participants ADD COLUMN excuse_reason TEXT;
ALTER TABLE event_participants ADD COLUMN excused_by_user_id TEXT REFERENCES users(id);

-- Backfill attendance_required from existing expected column if present
UPDATE event_participants SET attendance_required = expected WHERE expected IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_participants_req ON event_participants(occurrence_id, attendance_required, excused);

-- 2. Update student_obligations with source event, batch ID, and due date
ALTER TABLE student_obligations ADD COLUMN related_event_id TEXT REFERENCES events(id);
ALTER TABLE student_obligations ADD COLUMN due_date TEXT;
ALTER TABLE student_obligations ADD COLUMN batch_id TEXT;

-- Prevent duplicate active absence fines for the same student, occurrence, and rule
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_absence_obligation ON student_obligations(student_id, rule_id, related_occurrence_id)
  WHERE related_occurrence_id IS NOT NULL AND rule_id IS NOT NULL AND status='ACTIVE';

CREATE INDEX IF NOT EXISTS idx_obligations_batch ON student_obligations(batch_id);

-- 3. Upgrade payments table to support CASH_RECORDED and MANUAL_TRANSFER_RECORD
CREATE TABLE IF NOT EXISTS payments_v2 (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  semester_id TEXT NOT NULL REFERENCES semesters(id),
  reference_number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount_centavos INTEGER NOT NULL CHECK(amount_centavos>0),
  source TEXT NOT NULL CHECK(source IN ('CASH_RECORDED','MANUAL_TRANSFER_RECORD','SIMULATED_WALLET')),
  channel TEXT NOT NULL CHECK(channel IN ('NFC','MANUAL')),
  status TEXT NOT NULL DEFAULT 'POSTED' CHECK(status IN ('POSTED','REVERSED')),
  processed_by_user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT REFERENCES devices(id),
  processed_at TEXT NOT NULL,
  reversed_at TEXT,
  reversed_by_user_id TEXT REFERENCES users(id),
  reversal_reason TEXT,
  notes TEXT,
  CHECK(status <> 'REVERSED' OR (reversed_at IS NOT NULL AND length(trim(reversal_reason))>0))
);

INSERT INTO payments_v2 (
  id, student_id, semester_id, reference_number, idempotency_key, amount_centavos,
  source, channel, status, processed_by_user_id, device_id, processed_at,
  reversed_at, reversed_by_user_id, reversal_reason
)
SELECT
  id, student_id, semester_id, reference_number, idempotency_key, amount_centavos,
  source, channel, status, processed_by_user_id, device_id, processed_at,
  reversed_at, reversed_by_user_id, reversal_reason
FROM payments;

DROP TABLE payments;
ALTER TABLE payments_v2 RENAME TO payments;

CREATE INDEX IF NOT EXISTS idx_payments_semester ON payments(semester_id,status,processed_at);

PRAGMA foreign_keys = ON;
`;

