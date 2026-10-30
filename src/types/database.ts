export interface AcademicYear {
  id: string;
  label: string; // e.g. '2026-2027'
  starts_on: string;
  ends_on: string;
  status: 'PLANNED' | 'ACTIVE' | 'ARCHIVED';
}

export interface Semester {
  id: string;
  academic_year_id: string;
  term: 'FIRST' | 'SECOND' | 'SUMMER';
  starts_on: string;
  ends_on: string;
  status: 'PLANNED' | 'ACTIVE' | 'CLOSED';
}

export interface Program {
  id: string;
  code: string;
  name: string;
  is_active: number;
}

export interface StudentRecord {
  id: string;
  school_id: string;
  first_name: string;
  middle_name?: string | null;
  last_name: string;
  photo_local_uri?: string | null;
  photo_content_hash?: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'GRADUATED';
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface StudentEnrollment {
  id: string;
  student_id: string;
  semester_id: string;
  program_id?: string | null;
  year_level: number;
  section: string;
  enrollment_status: 'ENROLLED' | 'TRANSFERRED' | 'DROPPED' | 'COMPLETED';
  first_name_snapshot: string;
  middle_name_snapshot?: string | null;
  last_name_snapshot: string;
  updated_at: string;
}

export interface ProfileConfirmation {
  id: string;
  student_id: string;
  semester_id: string;
  status: 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  snapshot_json?: string | null;
  submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by_user_id?: string | null;
  remarks?: string | null;
}

export interface UserAccount {
  id: string;
  username: string;
  student_id?: string | null;
  account_status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCredential {
  user_id: string;
  password_hash: string;
  algorithm: 'ARGON2ID';
  provisioned_at: string;
  last_online_verified_at?: string | null;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: 'DEVADMIN' | 'OFFICER' | 'STUDENT';
  semester_id?: string | null;
  assigned_by_user_id?: string | null;
  assigned_at: string;
  revoked_at?: string | null;
}

export interface DeviceRecord {
  id: string;
  device_name: string;
  device_code: string;
  status: 'ACTIVE' | 'REVOKED';
  provisioned_by_user_id?: string | null;
  provisioned_at: string;
  last_sync_at?: string | null;
}

export interface ActivationClaim {
  id: string;
  student_id: string;
  token_hash: string;
  issued_by_user_id: string;
  expires_at: string;
  used_at?: string | null;
  revoked_at?: string | null;
  created_at: string;
}

export interface NfcCardRecord {
  id: string;
  student_id: string;
  uid_normalized: string;
  status: 'ACTIVE' | 'LOST' | 'REPLACED' | 'DEACTIVATED';
  assigned_at: string;
  assigned_by_user_id?: string | null;
  revoked_at?: string | null;
  revoked_by_user_id?: string | null;
  reason?: string | null;
}

export interface EventRecord {
  id: string;
  semester_id: string;
  title: string;
  description?: string | null;
  event_type: string;
  audience_type: 'ALL' | 'YEAR' | 'SECTION';
  audience_json: string;
  attendance_required: number;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventOccurrenceRecord {
  id: string;
  event_id: string;
  title: string;
  occurs_on: string;
  starts_at: string;
  ends_at: string;
  grace_minutes: number;
  status: 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
  opened_at?: string | null;
  closed_at?: string | null;
  updated_at: string;
}

export interface AttendanceRecord {
  id: string;
  occurrence_id: string;
  student_id: string;
  status: 'PENDING' | 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED' | 'VOID';
  checked_in_at?: string | null;
  method?: 'NFC' | 'MANUAL' | null;
  identity_verified_by_user_id?: string | null;
  photo_checked: number;
  voided_at?: string | null;
  voided_by_user_id?: string | null;
  void_reason?: string | null;
  updated_at: string;
}

export interface AttendanceAttemptRecord {
  id: string;
  occurrence_id: string;
  student_id?: string | null;
  card_id?: string | null;
  uid_normalized: string;
  actor_user_id?: string | null;
  device_id?: string | null;
  result: 'ACCEPTED' | 'DUPLICATE' | 'UNKNOWN_CARD' | 'INACTIVE_CARD' | 'INACTIVE_STUDENT' | 'NOT_ELIGIBLE' | 'SESSION_CLOSED' | 'IDENTITY_REJECTED' | 'ERROR';
  photo_displayed: number;
  notes?: string | null;
  occurred_at: string;
}

export interface ObligationRule {
  id: string;
  semester_id: string;
  name: string;
  type: 'FINE' | 'CONTRIBUTION';
  trigger_type: 'MANUAL' | 'ABSENCE' | 'LATE' | 'EVENT';
  default_amount_centavos: number;
  due_on?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  created_by_user_id?: string | null;
  created_at: string;
}

export interface StudentObligation {
  id: string;
  student_id: string;
  semester_id: string;
  rule_id?: string | null;
  related_occurrence_id?: string | null;
  title: string;
  type: 'FINE' | 'CONTRIBUTION';
  amount_centavos: number;
  status: 'ACTIVE' | 'VOID';
  issued_by_user_id?: string | null;
  issued_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
  updated_at: string;
}

export interface PaymentRecord {
  id: string;
  student_id: string;
  semester_id: string;
  reference_number: string;
  idempotency_key: string;
  amount_centavos: number;
  source: 'SIMULATED_WALLET' | 'CASH_RECORDED';
  channel: 'NFC' | 'MANUAL';
  status: 'POSTED' | 'REVERSED';
  processed_by_user_id: string;
  device_id?: string | null;
  processed_at: string;
  reversed_at?: string | null;
  reversed_by_user_id?: string | null;
  reversal_reason?: string | null;
}

export interface PaymentAllocationRecord {
  id: string;
  payment_id: string;
  obligation_id: string;
  amount_centavos: number;
}

export interface SimulatedWalletRecord {
  id: string;
  student_id: string;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  created_at: string;
}

export interface SimulatedWalletLedgerRecord {
  id: string;
  wallet_id: string;
  kind: 'TOP_UP' | 'PAYMENT' | 'TOPUP_REVERSAL' | 'PAYMENT_REVERSAL' | 'ADJUSTMENT_CREDIT' | 'ADJUSTMENT_DEBIT';
  amount_centavos: number;
  related_payment_id?: string | null;
  reference_number: string;
  processed_by_user_id: string;
  created_at: string;
}

export interface ImportBatchRecord {
  id: string;
  semester_id: string;
  source_filename: string;
  sha256: string;
  imported_by_user_id: string;
  imported_at: string;
  status: 'VALIDATING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  total_rows: number;
  imported_rows: number;
  rejected_rows: number;
}

export interface ImportRowRecord {
  id: string;
  batch_id: string;
  row_number: number;
  raw_json: string;
  result: 'IMPORTED' | 'UPDATED' | 'REJECTED' | 'SKIPPED';
  student_id?: string | null;
  error_message?: string | null;
}

export interface ReportExportRecord {
  id: string;
  semester_id: string;
  report_type: 'FINES' | 'CONTRIBUTIONS' | 'COMBINED' | 'ATTENDANCE';
  filters_json: string;
  totals_json: string;
  local_file_uri?: string | null;
  generated_by_user_id: string;
  generated_at: string;
}

export interface AuditEventRecord {
  id: string;
  actor_user_id?: string | null;
  device_id?: string | null;
  entity_type: string;
  entity_id: string;
  action: string;
  details_json: string;
  occurred_at: string;
}

export interface SyncOutboxRecord {
  id: string;
  device_id: string;
  entity_type: string;
  entity_id: string;
  operation: 'CREATE' | 'UPDATE' | 'VOID' | 'REVOKE';
  payload_json: string;
  schema_version: number;
  created_at: string;
  synced_at?: string | null;
  retry_count: number;
  last_error?: string | null;
}

