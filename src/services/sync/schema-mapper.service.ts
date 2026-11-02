import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';

export const SYNC_TABLE_ALLOWLIST = [
  'academic_years',
  'semesters',
  'programs',
  'year_levels',
  'sections',
  'event_categories',
  'events',
  'event_occurrences',
  'students',
  'student_enrollments',
  'nfc_cards',
  'event_participants',
  'attendance_records',
  'attendance_audit',
  'obligation_rules',
  'student_obligations',
  'payments',
  'payment_allocations',
] as const;

export type SyncTableName = (typeof SYNC_TABLE_ALLOWLIST)[number];

export function isSyncTable(table: string): table is SyncTableName {
  return (SYNC_TABLE_ALLOWLIST as readonly string[]).includes(table);
}

export const TABLE_TO_ENTITY_TYPES: Record<string, string[]> = {
  academic_years: ['ACADEMIC_YEAR', 'academic_years'],
  semesters: ['SEMESTER', 'semesters'],
  programs: ['PROGRAM', 'programs'],
  year_levels: ['YEAR_LEVEL', 'year_levels'],
  sections: ['SECTION', 'sections'],
  event_categories: ['EVENT_CATEGORY', 'event_categories'],
  obligation_rules: ['OBLIGATION_RULE', 'obligation_rules'],
  events: ['EVENT', 'events'],
  event_occurrences: ['OCCURRENCE', 'event_occurrences', 'EVENT_OCCURRENCE'],
  event_participants: ['PARTICIPANT', 'event_participants', 'EVENT_PARTICIPANT'],
  students: ['STUDENT', 'students'],
  student_enrollments: ['ENROLLMENT', 'student_enrollments', 'STUDENT_ENROLLMENT'],
  nfc_cards: ['CARD', 'nfc_cards', 'NFC_CARD'],
  attendance_records: ['ATTENDANCE', 'attendance_records', 'ATTENDANCE_RECORD'],
  attendance_audit: ['ATTENDANCE_VOID', 'attendance_audit'],
  student_obligations: ['OBLIGATION', 'student_obligations', 'STUDENT_OBLIGATION'],
  payments: ['PAYMENT', 'payments'],
  payment_allocations: ['PAYMENT_ALLOCATION', 'payment_allocations', 'PAYMENT'],
};

export class SchemaMapperService {
  /**
   * Strict exact-integer parsing for Philippine Centavos.
   * Internal currency values MUST be integer centavos (₱100.00 = 10000).
   * Rejects floating points, fractions, non-integer strings, unsafe integers, and precision loss.
   */
  public static toIntegerCentavos(val: unknown, fieldName = 'amount'): number {
    if (val === null || val === undefined) {
      throw new Error(`Financial field "${fieldName}" cannot be null or undefined.`);
    }

    if (typeof val === 'number') {
      if (isNaN(val) || !isFinite(val)) {
        throw new Error(`Financial field "${fieldName}" is not a finite number: ${val}`);
      }
      if (!Number.isSafeInteger(val)) {
        throw new Error(
          `Financial field "${fieldName}" must be a safe integer centavos value, got fractional or unsafe number: ${val}`
        );
      }
      return val;
    }

    if (typeof val === 'bigint') {
      if (val > BigInt(Number.MAX_SAFE_INTEGER) || val < BigInt(Number.MIN_SAFE_INTEGER)) {
        throw new Error(
          `Financial field "${fieldName}" BigInt exceeds JavaScript safe integer range: ${val.toString()}`
        );
      }
      return Number(val);
    }

    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (!/^-?\d+$/.test(trimmed)) {
        throw new Error(
          `Financial field "${fieldName}" contains non-integer characters or fractions: "${val}"`
        );
      }
      const parsed = Number(trimmed);
      if (!Number.isSafeInteger(parsed)) {
        throw new Error(
          `Financial field "${fieldName}" exceeds JavaScript safe integer range: "${val}"`
        );
      }
      return parsed;
    }

    throw new Error(
      `Financial field "${fieldName}" has invalid type (${typeof val}): ${String(val)}`
    );
  }

  /**
   * Safe ISO date string conversion.
   */
  public static toIsoString(val: unknown): string | null {
    if (!val) return null;
    try {
      const d = new Date(val as string | number);
      return isNaN(d.getTime()) ? null : d.toISOString();
    } catch {
      return null;
    }
  }

  /**
   * Safe boolean to integer conversion (SQLite has no boolean type).
   */
  public static toBooleanInt(val: unknown, fallback = 0): number {
    if (val === true || val === 1 || val === '1' || val === 'true' || val === 'ACTIVE') return 1;
    if (val === false || val === 0 || val === '0' || val === 'false' || val === 'INACTIVE') return 0;
    return fallback;
  }

  /**
   * Maps server payload to local SQLite schema columns for any supported table.
   * Drops server-only or unknown fields and normalizes types.
   */
  public static mapRecord(tableName: string, raw: Record<string, any>): Record<string, any> {
    if (!raw || typeof raw !== 'object') return {};

    switch (tableName) {
      case 'academic_years':
        return {
          id: String(raw.id),
          label: String(raw.label || raw.title || ''),
          starts_on: String(raw.starts_on),
          ends_on: String(raw.ends_on),
          status: ['PLANNED', 'ACTIVE', 'ARCHIVED'].includes(raw.status) ? raw.status : 'PLANNED',
          created_at: this.toIsoString(raw.created_at),
          updated_at: this.toIsoString(raw.updated_at),
        };

      case 'semesters':
        return {
          id: String(raw.id),
          academic_year_id: String(raw.academic_year_id),
          term: ['FIRST', 'SECOND', 'SUMMER'].includes(raw.term) ? raw.term : 'FIRST',
          starts_on: String(raw.starts_on),
          ends_on: String(raw.ends_on),
          status: ['PLANNED', 'ACTIVE', 'CLOSED'].includes(raw.status) ? raw.status : 'PLANNED',
          created_at: this.toIsoString(raw.created_at),
          updated_at: this.toIsoString(raw.updated_at),
        };

      case 'programs': {
        let isActive: number;
        if (raw.status !== undefined) {
          isActive = raw.status === 'ACTIVE' ? 1 : 0;
        } else if (raw.is_active !== undefined) {
          isActive = this.toBooleanInt(raw.is_active, 1);
        } else {
          isActive = 1;
        }
        return {
          id: String(raw.id),
          code: String(raw.code),
          name: String(raw.name),
          is_active: isActive,
          status: raw.status || (isActive ? 'ACTIVE' : 'INACTIVE'),
        };
      }

      case 'year_levels':
        return {
          id: String(raw.id),
          level_number: Number(raw.level_number) || 1,
          name: String(raw.name || raw.display_name || `Year ${raw.level_number || 1}`),
          display_name: String(raw.display_name || raw.name || `Year ${raw.level_number || 1}`),
          status: ['ACTIVE', 'INACTIVE'].includes(raw.status) ? raw.status : 'ACTIVE',
          sort_order: Number(raw.sort_order) || Number(raw.level_number) || 0,
          created_at: this.toIsoString(raw.created_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || new Date().toISOString(),
        };

      case 'sections':
        return {
          id: String(raw.id),
          name: String(raw.name || raw.section_name || ''),
          section_name: String(raw.section_name || raw.name || ''),
          year_level_id: String(raw.year_level_id),
          program_id: raw.program_id ? String(raw.program_id) : null,
          academic_year_id: raw.academic_year_id ? String(raw.academic_year_id) : null,
          status: ['ACTIVE', 'INACTIVE'].includes(raw.status) ? raw.status : 'ACTIVE',
          created_at: this.toIsoString(raw.created_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || new Date().toISOString(),
        };

      case 'event_categories':
        return {
          id: String(raw.id),
          code: String(raw.code),
          name: String(raw.name),
          description: raw.description ? String(raw.description) : null,
          status: ['ACTIVE', 'INACTIVE'].includes(raw.status) ? raw.status : 'ACTIVE',
          sort_order: Number(raw.sort_order) || 0,
          created_by_user_id: raw.created_by_user_id ? String(raw.created_by_user_id) : null,
          created_at: this.toIsoString(raw.created_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || new Date().toISOString(),
        };

      case 'events': {
        const validStatuses = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
        const mappedStatus = validStatuses.includes(raw.status)
          ? raw.status
          : raw.status === 'PUBLISHED'
            ? 'ACTIVE'
            : 'DRAFT';
        return {
          id: String(raw.id),
          category_id: raw.category_id ? String(raw.category_id) : null,
          semester_id: String(raw.semester_id),
          title: String(raw.title),
          description: raw.description ? String(raw.description) : null,
          venue: raw.venue ? String(raw.venue) : null,
          event_type: String(raw.event_type || 'OTHER'),
          audience_type: ['ALL', 'YEAR', 'SECTION'].includes(raw.audience_type) ? raw.audience_type : 'ALL',
          audience_json: typeof raw.audience_json === 'object' ? JSON.stringify(raw.audience_json) : String(raw.audience_json || '{}'),
          attendance_required: this.toBooleanInt(raw.attendance_required, 1),
          status: mappedStatus,
          created_by_user_id: raw.created_by_user_id ? String(raw.created_by_user_id) : null,
          created_at: this.toIsoString(raw.created_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || this.toIsoString(raw.created_at) || new Date().toISOString(),
        };
      }

      case 'event_occurrences': {
        const titleOrLabel = String(raw.title || raw.label || 'Attendance Session');
        const occursOn = String(
          raw.occurs_on ||
          (raw.starts_at ? String(raw.starts_at).substring(0, 10) : new Date().toISOString().substring(0, 10))
        );
        const validStatuses = ['SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED'];
        const mappedStatus = validStatuses.includes(raw.status)
          ? raw.status
          : raw.status === 'COMPLETED'
            ? 'CLOSED'
            : 'SCHEDULED';

        return {
          id: String(raw.id),
          event_id: String(raw.event_id),
          title: titleOrLabel,
          label: String(raw.label || titleOrLabel),
          occurs_on: occursOn,
          starts_at: String(raw.starts_at),
          ends_at: String(raw.ends_at),
          grace_minutes: Number(raw.grace_minutes) || 15,
          status: mappedStatus,
          opened_at: this.toIsoString(raw.opened_at),
          closed_at: this.toIsoString(raw.closed_at),
          updated_at: this.toIsoString(raw.updated_at) || new Date().toISOString(),
        };
      }

      case 'students':
        return {
          id: String(raw.id),
          school_id: String(raw.school_id),
          first_name: String(raw.first_name),
          middle_name: raw.middle_name ? String(raw.middle_name) : null,
          last_name: String(raw.last_name),
          photo_storage_path: raw.photo_storage_path ? String(raw.photo_storage_path) : null,
          photo_content_hash: raw.photo_content_hash ? String(raw.photo_content_hash) : null,
          status: ['ACTIVE', 'INACTIVE', 'GRADUATED'].includes(raw.status) ? raw.status : 'ACTIVE',
          created_at: this.toIsoString(raw.created_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || new Date().toISOString(),
          deleted_at: this.toIsoString(raw.deleted_at),
        };

      case 'student_enrollments':
        return {
          id: String(raw.id),
          student_id: String(raw.student_id),
          semester_id: String(raw.semester_id),
          program_id: raw.program_id ? String(raw.program_id) : null,
          year_level: Number(raw.year_level) || 1,
          year_level_id: raw.year_level_id ? String(raw.year_level_id) : null,
          section: String(raw.section || 'Default'),
          section_id: raw.section_id ? String(raw.section_id) : null,
          enrollment_status: ['ENROLLED', 'TRANSFERRED', 'DROPPED', 'COMPLETED'].includes(raw.enrollment_status)
            ? raw.enrollment_status
            : 'ENROLLED',
          first_name_snapshot: String(raw.first_name_snapshot || raw.first_name || ''),
          middle_name_snapshot: raw.middle_name_snapshot ? String(raw.middle_name_snapshot) : null,
          last_name_snapshot: String(raw.last_name_snapshot || raw.last_name || ''),
          academic_year_id: raw.academic_year_id ? String(raw.academic_year_id) : null,
          updated_at: this.toIsoString(raw.updated_at) || new Date().toISOString(),
        };

      case 'nfc_cards': {
        const normUid = String(raw.uid_normalized || raw.uid || '').toUpperCase();
        const assignedAt = this.toIsoString(raw.assigned_at || raw.issued_at) || new Date().toISOString();
        const assignedBy = raw.assigned_by_user_id || raw.issued_by_user_id
          ? String(raw.assigned_by_user_id || raw.issued_by_user_id)
          : null;
        const validStatuses = ['ACTIVE', 'LOST', 'REPLACED', 'DEACTIVATED'];
        const statusVal = validStatuses.includes(raw.status) ? raw.status : 'ACTIVE';

        return {
          id: String(raw.id),
          uid_normalized: normUid,
          uid: normUid,
          student_id: String(raw.student_id),
          status: statusVal,
          assigned_at: assignedAt,
          issued_at: assignedAt,
          assigned_by_user_id: assignedBy,
          issued_by_user_id: assignedBy,
          deactivated_at: this.toIsoString(raw.deactivated_at || raw.revoked_at),
          revoked_at: this.toIsoString(raw.revoked_at || raw.deactivated_at),
          note: raw.note || raw.reason ? String(raw.note || raw.reason) : null,
          reason: raw.reason || raw.note ? String(raw.reason || raw.note) : null,
          updated_at: this.toIsoString(raw.updated_at) || assignedAt,
        };
      }

      case 'event_participants':
        return {
          id: String(raw.id),
          occurrence_id: String(raw.occurrence_id),
          student_id: String(raw.student_id),
          enrollment_id: raw.enrollment_id ? String(raw.enrollment_id) : null,
          attendance_required: this.toBooleanInt(raw.attendance_required ?? raw.expected, 1),
          expected: this.toBooleanInt(raw.attendance_required ?? raw.expected, 1),
          excused: this.toBooleanInt(raw.excused, 0),
          excuse_reason: raw.excuse_reason ? String(raw.excuse_reason) : null,
          excused_by_user_id: raw.excused_by_user_id ? String(raw.excused_by_user_id) : null,
          added_at: this.toIsoString(raw.added_at) || this.toIsoString(raw.updated_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || this.toIsoString(raw.added_at) || new Date().toISOString(),
        };

      case 'attendance_records': {
        const method = ['NFC', 'MANUAL'].includes(raw.method || raw.scan_method)
          ? (raw.method || raw.scan_method)
          : 'NFC';

        // checked_in_at represents physical check-in / server registration time
        const checkedInAt =
          this.toIsoString(raw.checked_in_at || raw.scanned_at) ||
          new Date().toISOString();

        // client_scanned_at represents device local scan time (distinct semantic event)
        // Strictly never fall back to checked_in_at or scanned_at
        const clientScannedAt = raw.client_scanned_at
          ? this.toIsoString(raw.client_scanned_at)
          : null;

        const officerId = raw.identity_verified_by_user_id || raw.scanned_by_user_id || null;

        // Map status faithfully to SQLite CHECK constraint: ('PENDING','PRESENT','LATE','ABSENT','EXCUSED','VOID')
        let status = raw.status;
        if (status === 'REVOKED') {
          status = 'VOID';
        } else if (!['PENDING', 'PRESENT', 'LATE', 'ABSENT', 'EXCUSED', 'VOID'].includes(status)) {
          status = 'PRESENT';
        }

        const voidedAt = this.toIsoString(raw.voided_at || raw.revoked_at);
        const voidedBy = raw.voided_by_user_id || raw.revoked_by_user_id
          ? String(raw.voided_by_user_id || raw.revoked_by_user_id)
          : null;
        const voidReason = raw.void_reason || raw.revocation_reason
          ? String(raw.void_reason || raw.revocation_reason)
          : (status === 'VOID' ? 'Administrative revocation' : null);

        let version = 1;
        if (typeof raw.version === 'number' && Number.isSafeInteger(raw.version) && raw.version >= 1) {
          version = raw.version;
        } else if (typeof raw.version === 'string' && /^\d+$/.test(raw.version.trim())) {
          const parsed = Number(raw.version.trim());
          if (parsed >= 1) version = parsed;
        }

        return {
          id: String(raw.id),
          occurrence_id: String(raw.occurrence_id),
          student_id: String(raw.student_id),
          status: status,
          checked_in_at: checkedInAt,
          method: method,
          identity_verified_by_user_id: officerId ? String(officerId) : null,
          photo_checked: this.toBooleanInt(raw.photo_checked, 0),
          voided_at: voidedAt,
          voided_by_user_id: voidedBy,
          void_reason: voidReason,
          revoked_at: voidedAt,
          revoked_by_user_id: voidedBy,
          revocation_reason: voidReason,
          client_scanned_at: clientScannedAt,
          version: version,
          notes: raw.notes ? String(raw.notes) : null,
          updated_at: this.toIsoString(raw.updated_at) || checkedInAt,
        };
      }

      case 'attendance_audit':
        return {
          id: String(raw.id),
          attendance_id: String(raw.attendance_id),
          occurrence_id: raw.occurrence_id ? String(raw.occurrence_id) : null,
          student_id: raw.student_id ? String(raw.student_id) : null,
          action: String(raw.action || 'UPDATE'),
          old_status: raw.old_status ? String(raw.old_status) : null,
          new_status: raw.new_status ? String(raw.new_status) : null,
          actor_user_id: raw.actor_user_id || raw.performed_by_user_id
            ? String(raw.actor_user_id || raw.performed_by_user_id)
            : null,
          performed_by_user_id: raw.performed_by_user_id || raw.actor_user_id
            ? String(raw.performed_by_user_id || raw.actor_user_id)
            : null,
          created_at: this.toIsoString(raw.created_at || raw.performed_at) || new Date().toISOString(),
          performed_at: this.toIsoString(raw.performed_at || raw.created_at) || new Date().toISOString(),
          reason: raw.reason ? String(raw.reason) : null,
        };

      case 'obligation_rules': {
        const nameVal = String(raw.name || raw.title || 'Obligation Rule');
        const typeVal = ['FINE', 'CONTRIBUTION'].includes(raw.type)
          ? raw.type
          : raw.obligation_type === 'CONTRIBUTION'
            ? 'CONTRIBUTION'
            : 'FINE';
        const triggerTypeVal = ['MANUAL', 'ABSENCE', 'LATE', 'EVENT'].includes(raw.trigger_type)
          ? raw.trigger_type
          : 'MANUAL';
        const defaultAmountCentavos = this.toIntegerCentavos(
          raw.default_amount_centavos ?? raw.amount_centavos,
          'obligation_rules.default_amount_centavos'
        );
        const statusVal = ['ACTIVE', 'INACTIVE'].includes(raw.status) ? raw.status : 'ACTIVE';

        return {
          id: String(raw.id),
          semester_id: String(raw.semester_id),
          name: nameVal,
          type: typeVal,
          trigger_type: triggerTypeVal,
          default_amount_centavos: defaultAmountCentavos,
          due_on: raw.due_on ? String(raw.due_on) : null,
          status: statusVal,
          created_by_user_id: raw.created_by_user_id ? String(raw.created_by_user_id) : null,
          created_at: this.toIsoString(raw.created_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || this.toIsoString(raw.created_at) || new Date().toISOString(),
        };
      }

      case 'student_obligations': {
        const obType = ['FINE', 'CONTRIBUTION'].includes(raw.type)
          ? raw.type
          : raw.obligation_type === 'CONTRIBUTION'
            ? 'CONTRIBUTION'
            : 'FINE';
        const occId = raw.related_occurrence_id || raw.occurrence_id || null;
        const mappedStatus = ['ACTIVE', 'VOID'].includes(raw.status)
          ? raw.status
          : raw.status === 'CANCELLED'
            ? 'VOID'
            : 'ACTIVE';

        return {
          id: String(raw.id),
          student_id: String(raw.student_id),
          semester_id: String(raw.semester_id),
          rule_id: raw.rule_id ? String(raw.rule_id) : null,
          related_event_id: raw.related_event_id ? String(raw.related_event_id) : null,
          related_occurrence_id: occId ? String(occId) : null,
          title: String(raw.title || 'Obligation'),
          type: obType,
          amount_centavos: this.toIntegerCentavos(
            raw.amount_centavos,
            'student_obligations.amount_centavos'
          ),
          status: mappedStatus,
          due_date: raw.due_date ? String(raw.due_date) : null,
          issued_by_user_id: raw.issued_by_user_id ? String(raw.issued_by_user_id) : null,
          batch_id: raw.batch_id ? String(raw.batch_id) : null,
          issued_at: this.toIsoString(raw.issued_at) || new Date().toISOString(),
          updated_at: this.toIsoString(raw.updated_at) || this.toIsoString(raw.issued_at) || new Date().toISOString(),
          voided_at: this.toIsoString(raw.voided_at),
          void_reason: raw.void_reason ? String(raw.void_reason) : null,
        };
      }

      case 'payments': {
        if (!raw.reference_number || !String(raw.reference_number).trim()) {
          throw new Error(`Authoritative payment record ${raw.id} is missing required reference_number.`);
        }
        if (!raw.idempotency_key || !String(raw.idempotency_key).trim()) {
          throw new Error(`Authoritative payment record ${raw.id} is missing required idempotency_key.`);
        }
        const ref = String(raw.reference_number).trim();
        const ik = String(raw.idempotency_key).trim();
        const validSources = ['CASH_RECORDED', 'MANUAL_TRANSFER_RECORD', 'SIMULATED_WALLET'];
        const validStatuses = ['POSTED', 'REVERSED'];

        return {
          id: String(raw.id),
          student_id: String(raw.student_id),
          semester_id: String(raw.semester_id),
          reference_number: ref,
          idempotency_key: ik,
          amount_centavos: this.toIntegerCentavos(
            raw.amount_centavos ?? raw.total_amount_centavos ?? raw.amount,
            'payments.amount_centavos'
          ),
          source: validSources.includes(raw.source) ? raw.source : 'CASH_RECORDED',
          channel: ['NFC', 'MANUAL'].includes(raw.channel) ? raw.channel : 'MANUAL',
          status: validStatuses.includes(raw.status) ? raw.status : 'POSTED',
          processed_by_user_id: String(raw.processed_by_user_id || 'system'),
          device_id: raw.device_id ? String(raw.device_id) : null,
          processed_at: this.toIsoString(raw.processed_at || raw.created_at) || new Date().toISOString(),
          reversed_at: this.toIsoString(raw.reversed_at),
          reversed_by_user_id: raw.reversed_by_user_id ? String(raw.reversed_by_user_id) : null,
          reversal_reason: raw.reversal_reason ? String(raw.reversal_reason) : null,
          notes: raw.notes ? String(raw.notes) : null,
          updated_at: this.toIsoString(raw.updated_at) || this.toIsoString(raw.processed_at) || new Date().toISOString(),
        };
      }

      case 'payment_allocations': {
        if (!raw.payment_id) {
          throw new Error(`Payment allocation ${raw.id} is missing required payment_id.`);
        }
        if (!raw.obligation_id) {
          throw new Error(`Payment allocation ${raw.id} is missing required obligation_id.`);
        }
        return {
          id: String(raw.id),
          payment_id: String(raw.payment_id),
          obligation_id: String(raw.obligation_id),
          amount_centavos: this.toIntegerCentavos(
            raw.amount_centavos ?? raw.allocated_amount_centavos ?? raw.amount,
            'payment_allocations.amount_centavos'
          ),
          created_at: this.toIsoString(raw.created_at) || new Date().toISOString(),
        };
      }

      default:
        // Generic fallback for any other table
        return { ...raw };
    }
  }

  /**
   * Checks whether there is an uncommitted local outbox operation for this entity.
   * If true, local changes must NOT be overwritten by incoming server data.
   */
  public static async hasPendingOutboxOperation(
    dbOrTx: DatabaseAdapter,
    tableName: string,
    entityId: string
  ): Promise<boolean> {
    if (!entityId) return false;
    const entityTypes = TABLE_TO_ENTITY_TYPES[tableName] || [tableName];
    const placeholders = entityTypes.map(() => '?').join(', ');
    const row = await dbOrTx.queryOne<{ id: string }>(
      `SELECT id FROM sync_outbox
       WHERE entity_id = ?
         AND synced_at IS NULL
         AND (entity_type IN (${placeholders}) OR entity_type = ?)
       LIMIT 1`,
      [entityId, ...entityTypes, tableName]
    );
    return !!row;
  }

  /**
   * Upserts a single mapped record safely into SQLite using ON CONFLICT(id) DO UPDATE.
   * Preserves local-only columns like photo_local_uri and prevents foreign key cascade deletes.
   */
  public static async safeUpsertRecord(
    tx: DatabaseAdapter,
    tableName: string,
    record: Record<string, any>,
    validColumns: Set<string>
  ): Promise<boolean> {
    const keys = Object.keys(record).filter((k) => validColumns.has(k) && record[k] !== undefined);
    if (keys.length === 0 || !keys.includes('id')) {
      return false;
    }

    // Resolve enrollment_id for event_participants if required by foreign key
    if (tableName === 'event_participants' && validColumns.has('enrollment_id') && !record.enrollment_id) {
      const enr = await tx.queryOne<{ id: string }>(
        'SELECT id FROM student_enrollments WHERE student_id = ? LIMIT 1',
        [record.student_id]
      );
      if (enr?.id) {
        record.enrollment_id = enr.id;
        if (!keys.includes('enrollment_id')) {
          keys.push('enrollment_id');
        }
      }
    }

    // Exclude id and local-only preserved columns from the DO UPDATE SET clause
    const updateKeys = keys.filter(
      (k) => k !== 'id' && !(tableName === 'students' && k === 'photo_local_uri')
    );

    const placeholders = keys.map(() => '?').join(', ');
    let sql: string;
    if (updateKeys.length > 0) {
      const setClauses = updateKeys.map((k) => `${k} = excluded.${k}`).join(', ');
      sql = `INSERT INTO ${tableName} (${keys.join(', ')})
             VALUES (${placeholders})
             ON CONFLICT(id) DO UPDATE SET ${setClauses}`;
    } else {
      sql = `INSERT INTO ${tableName} (${keys.join(', ')})
             VALUES (${placeholders})
             ON CONFLICT(id) DO NOTHING`;
    }

    const values = keys.map((k) => {
      const val = record[k];
      if (val === null || val === undefined) return null;
      if (typeof val === 'boolean') return val ? 1 : 0;
      if (typeof val === 'object') return JSON.stringify(val);
      return val;
    });

    await tx.execute(sql, values);
    return true;
  }

  /**
   * Processes a batch of records transactionally for a table:
   * 1. Filters columns against SQLite table schema.
   * 2. Checks pending outbox per record (skips if pending).
   * 3. Maps fields and normalizes types.
   * 4. Safe upserts without deleting existing rows.
   */
  public static async upsertBatchSafe(
    tx: DatabaseAdapter,
    tableName: string,
    records: any[]
  ): Promise<{ applied: number; skippedPending: number }> {
    if (!Array.isArray(records) || records.length === 0) {
      return { applied: 0, skippedPending: 0 };
    }

    const tableInfo = await tx.query<{ name: string }>(`PRAGMA table_info(${tableName})`);
    const validColumns = new Set<string>((tableInfo || []).map((c: { name: string }) => c.name));

    let applied = 0;
    let skippedPending = 0;

    for (const raw of records) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;

      const hasPending = await this.hasPendingOutboxOperation(tx, tableName, String(raw.id));
      if (hasPending) {
        skippedPending++;
        continue;
      }

      const mapped = this.mapRecord(tableName, raw);
      const success = await this.safeUpsertRecord(tx, tableName, mapped, validColumns);
      if (success) {
        applied++;
      }
    }

    return { applied, skippedPending };
  }
}
