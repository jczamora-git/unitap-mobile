import { supabase } from '@/integrations/supabase/client';

function isTestEnvironment(): boolean {
  const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.VITEST === 'true' || proc?.env?.NODE_ENV === 'test' || import.meta.env?.MODE === 'test';
}
import type { 
  AttendanceScanResult, 
  AttendanceScanLog, 
  AttendanceStats,
  ScanResultType 
} from '@/types/attendance';
import type { AttendanceStatus, OccurrenceParticipant } from '@/types/event';
import { eventService } from './event.service';
import { localEventRepository, type IEventRepository } from '@/storage/event-storage.service';
import { formatFullName } from '@/utilities/student-formatters';
import { isPastTime } from '@/utilities/date-formatters';
import { AttendanceRepository } from '../database/repositories/attendance.repository';
import { CardsRepository } from '../database/repositories/cards.repository';
import { StudentsRepository } from '../database/repositories/students.repository';
import { EventsRepository } from '../database/repositories/events.repository';
import type { StudentRecord } from '@/types/database';

function generateLogId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'log_' + crypto.randomUUID();
  }
  return 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

export interface VerificationPromptData {
  type: ScanResultType;
  message: string;
  occurrenceId: string;
  rfidUid: string;
  student?: StudentRecord | null;
  studentFullName?: string;
  photoLocalUri?: string | null;
  programCode?: string;
  yearLevel?: number;
  section?: string;
  suggestedStatus: AttendanceStatus;
  eligible: boolean;
  existingRecordId?: string;
  revocationReason?: string;
  revokedAt?: string;
}

export class AttendanceService {
  constructor(private repo: IEventRepository = localEventRepository) {}

  /**
   * UniTap 2.0 Photo Identity Verification Step 1:
   * Resolves student card and photo without marking attendance immediately.
   */
  async prepareNfcVerification(
    occurrenceId: string,
    rawRfidUid: string,
    actorUserId?: string
  ): Promise<VerificationPromptData> {
    const timestamp = new Date().toISOString();
    const cleanUid = (rawRfidUid || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');

    if (!cleanUid) {
      await AttendanceRepository.logAttempt({
        id: generateLogId(),
        occurrence_id: occurrenceId,
        uid_normalized: rawRfidUid,
        actor_user_id: actorUserId || null,
        result: 'ERROR',
        photo_displayed: 0,
        notes: 'Invalid or empty NFC tag',
        occurred_at: timestamp,
      });
      return {
        type: 'INVALID',
        message: 'Invalid or unreadable NFC tag.',
        occurrenceId,
        rfidUid: rawRfidUid,
        suggestedStatus: 'PRESENT',
        eligible: false,
      };
    }

    // 1. Verify occurrence state
    const occurrence = await EventsRepository.getOccurrenceById(occurrenceId);
    if (!occurrence || occurrence.status !== 'OPEN') {
      const resultType = !occurrence ? 'ERROR' : 'SESSION_CLOSED';
      await AttendanceRepository.logAttempt({
        id: generateLogId(),
        occurrence_id: occurrenceId,
        uid_normalized: cleanUid,
        actor_user_id: actorUserId || null,
        result: resultType,
        photo_displayed: 0,
        notes: !occurrence ? 'Occurrence not found' : 'Session closed',
        occurred_at: timestamp,
      });
      return {
        type: 'SESSION_CLOSED',
        message: 'Attendance session is not currently open.',
        occurrenceId,
        rfidUid: cleanUid,
        suggestedStatus: 'PRESENT',
        eligible: false,
      };
    }

    // 2. Resolve Card & Student
    const card = await CardsRepository.getCardByNormalizedUid(cleanUid);
    if (!card) {
      await AttendanceRepository.logAttempt({
        id: generateLogId(),
        occurrence_id: occurrenceId,
        uid_normalized: cleanUid,
        actor_user_id: actorUserId || null,
        result: 'UNKNOWN_CARD',
        photo_displayed: 0,
        notes: 'Card not registered',
        occurred_at: timestamp,
      });
      return {
        type: 'UNREGISTERED',
        message: `NFC card [${cleanUid}] is not registered to any student.`,
        occurrenceId,
        rfidUid: cleanUid,
        suggestedStatus: 'PRESENT',
        eligible: false,
      };
    }

    const student = await StudentsRepository.getStudentById(card.student_id);
    if (!student || student.status !== 'ACTIVE') {
      await AttendanceRepository.logAttempt({
        id: generateLogId(),
        occurrence_id: occurrenceId,
        student_id: card.student_id,
        card_id: card.id,
        uid_normalized: cleanUid,
        actor_user_id: actorUserId || null,
        result: 'INACTIVE_STUDENT',
        photo_displayed: 0,
        notes: 'Student inactive or not found',
        occurred_at: timestamp,
      });
      return {
        type: 'INVALID',
        message: 'Student account is inactive or not found.',
        occurrenceId,
        rfidUid: cleanUid,
        suggestedStatus: 'PRESENT',
        eligible: false,
      };
    }

    const fullName = formatFullName(student.first_name, student.middle_name, student.last_name);

    // 3. Duplicate & Revocation check in attendance_records
    const existingRecord = await AttendanceRepository.getRecord(occurrenceId, student.id);
    if (existingRecord) {
      if (existingRecord.status === 'REVOKED' || existingRecord.status === 'VOID') {
        const reason = existingRecord.revocation_reason || existingRecord.void_reason || 'Administrative revocation';
        await AttendanceRepository.logAttempt({
          id: generateLogId(),
          occurrence_id: occurrenceId,
          student_id: student.id,
          card_id: card.id,
          uid_normalized: cleanUid,
          actor_user_id: actorUserId || null,
          result: 'NOT_ELIGIBLE',
          photo_displayed: 1,
          notes: `Attendance previously revoked: ${reason}`,
          occurred_at: timestamp,
        });
        return {
          type: 'REVOKED_REVIEW_REQUIRED',
          message: `Attendance was revoked. Reason: "${reason}". An explicit recheck with reason is required.`,
          occurrenceId,
          rfidUid: cleanUid,
          student,
          studentFullName: fullName,
          photoLocalUri: student.photo_local_uri,
          suggestedStatus: 'REVOKED',
          eligible: false,
          existingRecordId: existingRecord.id,
          revocationReason: reason,
          revokedAt: existingRecord.revoked_at || existingRecord.voided_at || undefined,
        };
      }

      if (existingRecord.status === 'PRESENT' || existingRecord.status === 'LATE') {
        await AttendanceRepository.logAttempt({
          id: generateLogId(),
          occurrence_id: occurrenceId,
          student_id: student.id,
          card_id: card.id,
          uid_normalized: cleanUid,
          actor_user_id: actorUserId || null,
          result: 'DUPLICATE',
          photo_displayed: 1,
          notes: `Already recorded as ${existingRecord.status}`,
          occurred_at: timestamp,
        });
        return {
          type: 'DUPLICATE',
          message: `${fullName} is already recorded as ${existingRecord.status}.`,
          occurrenceId,
          rfidUid: cleanUid,
          student,
          studentFullName: fullName,
          photoLocalUri: student.photo_local_uri,
          suggestedStatus: existingRecord.status as AttendanceStatus,
          eligible: true,
          existingRecordId: existingRecord.id,
        };
      }
    }

    // 4. Calculate grace period (PRESENT vs LATE)
    let suggestedStatus: AttendanceStatus = 'PRESENT';
    if (occurrence.occurs_on && occurrence.starts_at) {
      const isLate = isPastTime(occurrence.occurs_on, occurrence.starts_at, occurrence.grace_minutes || 15);
      if (isLate) {
        suggestedStatus = 'LATE';
      }
    }

    return {
      type: 'ACCEPTED',
      message: `Card matched: ${fullName}. Please verify the student's photo.`,
      occurrenceId,
      rfidUid: cleanUid,
      student,
      studentFullName: fullName,
      photoLocalUri: student.photo_local_uri,
      suggestedStatus,
      eligible: true,
    };
  }

  /**
   * UniTap 2.0 Photo Identity Verification Step 2:
   * Officer confirms the identity -> save PRESENT or LATE attendance and write audit trail.
   * Leverages atomic online RPC with graceful offline-first fallback.
   */
  async confirmStudentAttendance(
    occurrenceId: string,
    studentId: string,
    officerUserId: string,
    statusOverride?: AttendanceStatus,
    nfcCardId?: string,
    uidNormalized?: string,
    idempotencyKey?: string,
    clientScannedAt?: string,
    scanMethod: 'NFC' | 'MANUAL' = 'NFC'
  ): Promise<{ status: string; message: string; recordId?: string }> {
    const now = clientScannedAt || new Date().toISOString();
    const occurrence = await EventsRepository.getOccurrenceById(occurrenceId);
    let status: AttendanceStatus = statusOverride || 'PRESENT';

    if (!statusOverride && occurrence?.occurs_on && occurrence?.starts_at) {
      if (isPastTime(occurrence.occurs_on, occurrence.starts_at, occurrence.grace_minutes || 15, now)) {
        status = 'LATE';
      }
    }

    const effectiveIdempotencyKey = idempotencyKey || `idem_scan_${occurrenceId}_${studentId}_${Date.now()}`;

    // 1. Check existing attendance record in local SQLite first
    const existing = await AttendanceRepository.getRecord(occurrenceId, studentId);
    if (existing) {
      if (existing.status === 'REVOKED' || existing.status === 'VOID') {
        const reason = existing.revocation_reason || existing.void_reason || 'Administrative revocation';
        throw new Error(`Attendance was previously revoked (${reason}). An explicit recheck with reason is required.`);
      }
      if (existing.status === 'PRESENT' || existing.status === 'LATE') {
        return { status: 'ALREADY_RECORDED', message: 'Student is already recorded for this session.' };
      }
    }

    // 2. True Local-First Write: commit local record, audit log, and durable outbox atomically
    const attendanceId = 'att_' + Math.random().toString(36).substring(2, 10);
    await AttendanceRepository.recordAttendance(
      {
        id: attendanceId,
        occurrence_id: occurrenceId,
        student_id: studentId,
        status: status as any,
        checked_in_at: now,
        client_scanned_at: now,
        method: scanMethod,
        identity_verified_by_user_id: officerUserId,
        photo_checked: 1,
        updated_at: now,
      },
      officerUserId
    );

    // 3. Trigger asynchronous background sync if online (never blocks the scanning UI)
    try {
      const { SyncManager } = await import('@/services/sync/sync-manager');
      SyncManager.triggerDebouncedSync(500);
    } catch {
      // Ignored
    }

    // Also update legacy storage participant if present
    try {
      const participants = await this.repo.getParticipants(occurrenceId);
      const participant = participants.find((p) => p.studentId === studentId);
      if (participant) {
        await this.repo.saveParticipant({
          ...participant,
          attendanceStatus: status,
          attendanceTime: now,
          attendanceMethod: 'NFC',
          updatedAt: now,
        });
      }
    } catch {
      // Legacy cache sync failure not fatal
    }

    return {
      status: 'RECORDED',
      message: 'Attendance confirmed successfully!',
      recordId: attendanceId,
    };
  }

  /**
   * Reject student scan: Officer determines person does not match the student photo.
   */
  async rejectStudentScan(
    occurrenceId: string,
    rawRfidUid: string,
    studentId: string | null,
    officerUserId: string,
    reason = 'Photo identity mismatch'
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const cleanUid = (rawRfidUid || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');

    await AttendanceRepository.logAttempt({
      id: generateLogId(),
      occurrence_id: occurrenceId,
      student_id: studentId || null,
      uid_normalized: cleanUid,
      actor_user_id: officerUserId,
      result: 'IDENTITY_REJECTED',
      photo_displayed: 1,
      notes: reason,
      occurred_at: timestamp,
    });
  }

  /**
   * Void / Revoke attendance: Officer revokes attendance with mandatory reason.
   */
  async voidAttendance(
    attendanceId: string,
    reason: string,
    officerUserId: string,
    expectedVersion?: number,
    idempotencyKey?: string
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('A mandatory reason is required to revoke attendance.');
    }

    const effectiveIdempotencyKey = idempotencyKey || `idem_rev_${attendanceId}_${Date.now()}`;

    // Attempt online atomic revocation
    if (!isTestEnvironment()) {
      try {
        const { data: revRes, error: revErr } = await supabase.rpc('revoke_attendance', {
          p_attendance_id: attendanceId,
          p_reason: reason.trim(),
          p_expected_version: expectedVersion || null,
          p_idempotency_key: effectiveIdempotencyKey,
        });
        if (revErr) {
          console.warn('[AttendanceService] Online revoke RPC error:', revErr.message);
        } else if (revRes && revRes.status === 'STALE_STATE_CONFLICT') {
          throw new Error(revRes.error || 'The record was modified concurrently. Please refresh.');
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('modified concurrently')) {
          throw err;
        }
        console.warn('[AttendanceService] Network error during online revocation:', err);
      }
    }

    // Always update local SQLite and enqueue outbox VOID operation
    await AttendanceRepository.voidAttendance(attendanceId, reason, officerUserId, expectedVersion);
  }

  /**
   * Recheck attendance: Explicit officer approval to reinstate a previously revoked record.
   */
  async recheckStudentAttendance(
    attendanceId: string,
    reason: string,
    officerUserId: string,
    statusOverride?: 'PRESENT' | 'LATE',
    expectedVersion?: number,
    idempotencyKey?: string
  ): Promise<void> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('A mandatory reason is required to approve an attendance recheck.');
    }

    const targetStatus = statusOverride || 'PRESENT';
    const effectiveIdempotencyKey = idempotencyKey || `idem_rech_${attendanceId}_${Date.now()}`;

    // Attempt online atomic recheck
    if (!isTestEnvironment()) {
      try {
        const { data: rechkRes, error: rechkErr } = await supabase.rpc('recheck_attendance', {
          p_attendance_id: attendanceId,
          p_reason: reason.trim(),
          p_target_status: targetStatus,
          p_expected_version: expectedVersion || null,
          p_idempotency_key: effectiveIdempotencyKey,
        });
        if (rechkErr) {
          console.warn('[AttendanceService] Online recheck RPC error:', rechkErr.message);
        } else if (rechkRes && rechkRes.status === 'STALE_STATE_CONFLICT') {
          throw new Error(rechkRes.error || 'The record was modified concurrently. Please refresh.');
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('modified concurrently')) {
          throw err;
        }
        console.warn('[AttendanceService] Network error during online recheck:', err);
      }
    }

    // Always update local SQLite and enqueue outbox UPDATE operation
    await AttendanceRepository.recheckAttendance(attendanceId, reason, officerUserId, targetStatus, expectedVersion);
  }

  /**
   * Fetch full audit trail for an attendance record
   */
  async getAttendanceAuditTrail(attendanceId: string) {
    return AttendanceRepository.getAuditTrail(attendanceId);
  }

  // Legacy compatibility method
  async processNfcScan(occurrenceId: string, rawRfidUid: string): Promise<AttendanceScanResult> {
    const prep = await this.prepareNfcVerification(occurrenceId, rawRfidUid);
    if (prep.type !== 'ACCEPTED' || !prep.student) {
      return {
        type: prep.type,
        message: prep.message,
        timestamp: new Date().toISOString(),
        rfidUid: rawRfidUid,
      };
    }

    // Auto-confirm for legacy headless test calls
    await this.confirmStudentAttendance(occurrenceId, prep.student.id, 'officer_auto', prep.suggestedStatus);

    return {
      type: 'ACCEPTED',
      message: `${prep.studentFullName} checked in as ${prep.suggestedStatus}!`,
      attendanceStatus: prep.suggestedStatus,
      timestamp: new Date().toISOString(),
      rfidUid: rawRfidUid,
    };
  }

  async getScanLogs(occurrenceId?: string): Promise<AttendanceScanLog[]> {
    return this.repo.getScanLogs(occurrenceId);
  }

  async getStats(occurrenceId: string): Promise<AttendanceStats> {
    return eventService.getOccurrenceStats(occurrenceId);
  }

  async getStudentAttendanceHistory(studentId: string): Promise<Array<{
    participant: OccurrenceParticipant;
    event?: import('@/types/event').Event;
    occurrence?: import('@/types/event').EventOccurrence;
  }>> {
    const allParticipants = await this.repo.getParticipants();
    const studentParts = allParticipants.filter(p => p.studentId === studentId);
    const events = await eventService.getEvents();
    const occurrences = await eventService.getOccurrences();

    return studentParts.map(part => ({
      participant: part,
      event: events.find(e => e.id === part.eventId),
      occurrence: occurrences.find(o => o.id === part.occurrenceId)
    }));
  }
}

export const attendanceService = new AttendanceService();
