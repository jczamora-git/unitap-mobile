import type { DatabaseAdapter } from '@/database/adapters/database-adapter.interface';
import { getDatabase } from '@/database/database';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { SchemaMapperService } from './schema-mapper.service';
import { EntityCheckpointService } from './entity-checkpoint.service';
import { normalizeSchoolId, areSchoolIdsEquivalent } from '@/utilities/school-id-normalizer';
import type { StudentRecord } from '@/types/database';

export type ReconciliationAction =
  | 'INSERT'
  | 'UPDATE'
  | 'UNCHANGED'
  | 'IDENTITY_MATCH_REVIEW'
  | 'PENDING_LOCAL_CHANGE'
  | 'CONFLICT'
  | 'INVALID';

export interface FieldDifference {
  field: string;
  localVal: unknown;
  remoteVal: unknown;
}

export interface ProposedStudentOperation {
  id: string; // Unique plan operation ID
  remoteId: string;
  localId?: string;
  schoolId: string;
  canonicalSchoolId: string;
  localSchoolId?: string;
  studentName: string;
  localState: string;
  remoteState: string;
  action: ReconciliationAction;
  reason: string;
  remoteRecord: Record<string, any>;
  localRecord?: Record<string, any>;
  fieldDifferences: FieldDifference[];
  isSafeToApply: boolean;
  requiresReview: boolean;
  approved: boolean;
}

export interface PullPreviewPlan {
  planId: string;
  generatedAt: string;
  entity: string;
  remoteCount: number;
  localCount: number;
  summary: {
    toInsert: number;
    toUpdate: number;
    unchanged: number;
    identityMatches: number;
    pendingLocalChanges: number;
    conflicts: number;
    invalid: number;
  };
  operations: ProposedStudentOperation[];
  allSafe: boolean;
  nextSince?: string;
  nextLastId?: string;
  serverTime?: string;
}

export interface ReconciliationExecutionResult {
  success: boolean;
  appliedCount: number;
  skippedCount: number;
  reconciledIdentityCount: number;
  error?: string;
}

export class PullReconciliationService {
  /**
   * Preflight analyzes a batch of incoming remote student records against SQLite state
   * without advancing checkpoints or making database mutations.
   */
  public static async analyzeStudentBatch(
    dbOrTx: DatabaseAdapter,
    remoteRecords: any[]
  ): Promise<{
    operations: ProposedStudentOperation[];
    summary: PullPreviewPlan['summary'];
  }> {
    const operations: ProposedStudentOperation[] = [];
    const summary = {
      toInsert: 0,
      toUpdate: 0,
      unchanged: 0,
      identityMatches: 0,
      pendingLocalChanges: 0,
      conflicts: 0,
      invalid: 0,
    };

    for (let i = 0; i < remoteRecords.length; i++) {
      const remote = remoteRecords[i];
      const opId = `op_${i}_${remote?.id || 'unknown'}`;

      if (!remote || !remote.id) {
        summary.invalid++;
        operations.push({
          id: opId,
          remoteId: String(remote?.id || 'unknown'),
          schoolId: String(remote?.school_id || remote?.student_id_number || 'UNKNOWN'),
          canonicalSchoolId: '',
          studentName: 'Invalid Record',
          localState: 'Missing',
          remoteState: 'Corrupted payload',
          action: 'INVALID',
          reason: 'Record missing required ID or structure',
          remoteRecord: remote || {},
          fieldDifferences: [],
          isSafeToApply: false,
          requiresReview: true,
          approved: false,
        });
        continue;
      }

      const remoteId = String(remote.id);
      const rawSchoolId = String(remote.school_id || remote.student_id_number || '');
      const canonicalSchoolId = normalizeSchoolId(rawSchoolId);
      const studentName = `${remote.first_name || ''} ${remote.last_name || ''}`.trim() || 'Unnamed Student';

      // 1. Check if same UUID exists locally
      const localByUuid = await dbOrTx.queryOne<StudentRecord>(
        'SELECT * FROM students WHERE id = ?',
        [remoteId]
      );

      // Check if local has pending outbox operation for this UUID
      const hasPendingByUuid = await SchemaMapperService.hasPendingOutboxOperation(
        dbOrTx,
        'students',
        remoteId
      );

      if (localByUuid) {
        if (hasPendingByUuid) {
          summary.pendingLocalChanges++;
          operations.push({
            id: opId,
            remoteId,
            localId: localByUuid.id,
            schoolId: rawSchoolId,
            canonicalSchoolId,
            localSchoolId: localByUuid.school_id,
            studentName,
            localState: `Modified locally (${localByUuid.school_id})`,
            remoteState: 'Incoming remote update',
            action: 'PENDING_LOCAL_CHANGE',
            reason: 'Record has pending offline modifications in sync_outbox; local changes preserved',
            remoteRecord: remote,
            localRecord: localByUuid,
            fieldDifferences: this.computeDifferences(localByUuid, remote),
            isSafeToApply: false,
            requiresReview: true,
            approved: false,
          });
          continue;
        }

        // Compare data fields for UNCHANGED check
        const diffs = this.computeDifferences(localByUuid, remote);
        if (diffs.length === 0) {
          summary.unchanged++;
          operations.push({
            id: opId,
            remoteId,
            localId: localByUuid.id,
            schoolId: rawSchoolId,
            canonicalSchoolId,
            localSchoolId: localByUuid.school_id,
            studentName,
            localState: 'Identical to server',
            remoteState: 'Unchanged',
            action: 'UNCHANGED',
            reason: 'Data values are identical to local record; no database write needed',
            remoteRecord: remote,
            localRecord: localByUuid,
            fieldDifferences: [],
            isSafeToApply: true,
            requiresReview: false,
            approved: true,
          });
        } else {
          summary.toUpdate++;
          operations.push({
            id: opId,
            remoteId,
            localId: localByUuid.id,
            schoolId: rawSchoolId,
            canonicalSchoolId,
            localSchoolId: localByUuid.school_id,
            studentName,
            localState: 'Exists locally with same UUID',
            remoteState: 'Updated on server',
            action: 'UPDATE',
            reason: `Server fields differ: ${diffs.map((d) => d.field).join(', ')}`,
            remoteRecord: remote,
            localRecord: localByUuid,
            fieldDifferences: diffs,
            isSafeToApply: true,
            requiresReview: false,
            approved: true,
          });
        }
        continue;
      }

      // 2. UUID does not exist locally; check for canonical School ID match
      const matchingLocalStudents = await StudentsRepository.getStudentsByCanonicalSchoolId(
        canonicalSchoolId,
        dbOrTx
      );

      if (matchingLocalStudents.length === 1) {
        // Exactly one local student matches canonical School ID with different UUID!
        // This is Case B: IDENTITY_MATCH_REVIEW
        const localMatch = matchingLocalStudents[0];
        const hasPendingByLocalId = await SchemaMapperService.hasPendingOutboxOperation(
          dbOrTx,
          'students',
          localMatch.id
        );

        const diffs = this.computeDifferences(localMatch, remote);

        summary.identityMatches++;
        operations.push({
          id: opId,
          remoteId,
          localId: localMatch.id,
          schoolId: rawSchoolId,
          canonicalSchoolId,
          localSchoolId: localMatch.school_id,
          studentName: `${localMatch.first_name} ${localMatch.last_name}`.trim(),
          localState: `Exists as "${localMatch.school_id}" (UUID: ${localMatch.id.substring(0, 8)}...)`,
          remoteState: `Incoming as "${rawSchoolId}" (UUID: ${remoteId.substring(0, 8)}...)`,
          action: 'IDENTITY_MATCH_REVIEW',
          reason: `School ID formatting difference (${localMatch.school_id} vs ${rawSchoolId}). Reconcile client UUID to authoritative server identity.`,
          remoteRecord: remote,
          localRecord: localMatch,
          fieldDifferences: diffs,
          isSafeToApply: !hasPendingByLocalId,
          requiresReview: true,
          approved: !hasPendingByLocalId, // Recommended safe auto-merge unless pending changes
        });
        continue;
      }

      if (matchingLocalStudents.length > 1) {
        // Case E: Conflicting identities (multiple local matches for same canonical ID)
        summary.conflicts++;
        operations.push({
          id: opId,
          remoteId,
          schoolId: rawSchoolId,
          canonicalSchoolId,
          studentName,
          localState: `${matchingLocalStudents.length} local records match this canonical School ID`,
          remoteState: 'Single remote record',
          action: 'CONFLICT',
          reason: 'Ambiguous multiple local matches found. Manual resolution required.',
          remoteRecord: remote,
          fieldDifferences: [],
          isSafeToApply: false,
          requiresReview: true,
          approved: false,
        });
        continue;
      }

      // Case C: No matching UUID and no matching canonical School ID -> Clean INSERT
      summary.toInsert++;
      operations.push({
        id: opId,
        remoteId,
        schoolId: rawSchoolId,
        canonicalSchoolId,
        studentName,
        localState: 'Missing locally',
        remoteState: 'Active on server',
        action: 'INSERT',
        reason: 'New student record from server',
        remoteRecord: remote,
        fieldDifferences: [],
        isSafeToApply: true,
        requiresReview: false,
        approved: true,
      });
    }

    return { operations, summary };
  }

  /**
   * Generates a complete PullPreviewPlan for the students entity (read-only preflight).
   */
  public static async generatePreviewPlan(
    remoteRecords: any[],
    options?: {
      entity?: string;
      nextSince?: string;
      nextLastId?: string;
      serverTime?: string;
    }
  ): Promise<PullPreviewPlan> {
    const db = await getDatabase();
    const localCountRow = await db.queryOne<{ count: number }>(
      'SELECT count(*) as count FROM students WHERE deleted_at IS NULL'
    );
    const localCount = localCountRow?.count || 0;

    const { operations, summary } = await this.analyzeStudentBatch(db, remoteRecords);

    const allSafe =
      summary.conflicts === 0 &&
      summary.invalid === 0 &&
      summary.pendingLocalChanges === 0;

    return {
      planId: 'plan_' + Math.random().toString(36).substring(2, 10),
      generatedAt: new Date().toISOString(),
      entity: options?.entity || 'students',
      remoteCount: remoteRecords.length,
      localCount,
      summary,
      operations,
      allSafe,
      nextSince: options?.nextSince,
      nextLastId: options?.nextLastId,
      serverTime: options?.serverTime,
    };
  }

  /**
   * Atomically executes the approved operations within a SQLite transaction.
   * Preserves local-only values, remaps student child entities, and updates entity checkpoint.
   */
  public static async applyApprovedPlan(
    plan: PullPreviewPlan,
    adapter?: DatabaseAdapter
  ): Promise<ReconciliationExecutionResult> {
    const db = adapter || (await getDatabase());
    const validTableInfo = await db.query<{ name: string }>('PRAGMA table_info(students)');
    const validColumns = new Set<string>((validTableInfo || []).map((c: { name: string }) => c.name));

    let appliedCount = 0;
    let skippedCount = 0;
    let reconciledIdentityCount = 0;

    try {
      await db.transaction(async (tx) => {
        for (const op of plan.operations) {
          if (!op.approved) {
            skippedCount++;
            continue;
          }

          if (op.action === 'UNCHANGED') {
            // No SQLite write needed
            appliedCount++;
            continue;
          }

          if (op.action === 'IDENTITY_MATCH_REVIEW' && op.localId) {
            // Reconcile client UUID to authoritative server UUID
            const canonicalId = op.canonicalSchoolId || normalizeSchoolId(op.schoolId);
            await StudentsRepository.reconcileStudentId(
              op.localId,
              op.remoteId,
              canonicalId,
              tx
            );

            // Safe upsert remote fields onto the newly reconciled student record
            const mapped = SchemaMapperService.mapRecord('students', {
              ...op.remoteRecord,
              school_id: canonicalId,
            });
            await SchemaMapperService.safeUpsertRecord(tx, 'students', mapped, validColumns);

            reconciledIdentityCount++;
            appliedCount++;
            continue;
          }

          if (op.action === 'INSERT' || op.action === 'UPDATE') {
            const canonicalId = normalizeSchoolId(op.schoolId);
            const mapped = SchemaMapperService.mapRecord('students', {
              ...op.remoteRecord,
              school_id: canonicalId || op.schoolId,
            });
            const ok = await SchemaMapperService.safeUpsertRecord(
              tx,
              'students',
              mapped,
              validColumns
            );
            if (ok) {
              appliedCount++;
            } else {
              skippedCount++;
            }
            continue;
          }

          // Unhandled or non-approved action
          skippedCount++;
        }

        // If plan specifies checkpoint advancement and execution completed without error:
        if (plan.nextSince && plan.entity) {
          await EntityCheckpointService.updateCheckpointInTransaction(tx, {
            entity_name: plan.entity,
            last_pulled_at: plan.nextSince,
            last_pulled_id: plan.nextLastId || null,
            records_pulled: appliedCount,
            last_sync_status: 'SUCCESS',
            last_error_message: null,
          });
        }
      });

      return {
        success: true,
        appliedCount,
        skippedCount,
        reconciledIdentityCount,
      };
    } catch (err: unknown) {
      console.error('[PullReconciliationService] Transaction rollback during plan apply:', err);
      return {
        success: false,
        appliedCount: 0,
        skippedCount: plan.operations.length,
        reconciledIdentityCount: 0,
        error: (err as Error).message || 'Failed to apply sync preview plan.',
      };
    }
  }

  private static computeDifferences(
    local: Record<string, any>,
    remote: Record<string, any>
  ): FieldDifference[] {
    const diffs: FieldDifference[] = [];
    const fieldsToCompare = ['first_name', 'middle_name', 'last_name', 'status'];

    for (const field of fieldsToCompare) {
      const lVal = local[field] ?? null;
      const rVal = remote[field] ?? null;
      if (String(lVal || '').trim() !== String(rVal || '').trim()) {
        diffs.push({ field, localVal: lVal, remoteVal: rVal });
      }
    }

    // Compare school_id equivalence
    const lSchool = local.school_id || '';
    const rSchool = remote.school_id || '';
    if (!areSchoolIdsEquivalent(lSchool, rSchool)) {
      diffs.push({ field: 'school_id', localVal: lSchool, remoteVal: rSchool });
    }

    return diffs;
  }
}

