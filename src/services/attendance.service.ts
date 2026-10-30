import type { 
  AttendanceScanResult, 
  AttendanceScanLog, 
  AttendanceStats,
  ScanResultType 
} from '@/types/attendance';
import type { AttendanceStatus, OccurrenceParticipant } from '@/types/event';
import { eventService } from './event.service';
import { studentService } from './student.service';
import { localEventRepository, type IEventRepository } from '@/storage/event-storage.service';
import { formatFullName } from '@/utilities/student-formatters';
import { isPastTime } from '@/utilities/date-formatters';

function generateLogId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'log_' + crypto.randomUUID();
  }
  return 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

export class AttendanceService {
  constructor(private repo: IEventRepository = localEventRepository) {}

  async processNfcScan(occurrenceId: string, rawRfidUid: string): Promise<AttendanceScanResult> {
    const timestamp = new Date().toISOString();
    const cleanUid = (rawRfidUid || '').trim().toUpperCase();

    if (!cleanUid) {
      const result: AttendanceScanResult = {
        type: 'INVALID',
        message: 'Invalid or unreadable NFC tag.',
        timestamp,
        rfidUid: rawRfidUid
      };
      await this.logAttempt(occurrenceId, cleanUid, 'INVALID', result.message);
      return result;
    }

    // 1. Verify occurrence state
    const occurrence = await eventService.getOccurrence(occurrenceId);
    if (!occurrence) {
      const result: AttendanceScanResult = {
        type: 'INVALID',
        message: 'Attendance session not found.',
        timestamp,
        rfidUid: cleanUid
      };
      await this.logAttempt(occurrenceId, cleanUid, 'INVALID', result.message);
      return result;
    }

    if (occurrence.status !== 'OPEN') {
      const result: AttendanceScanResult = {
        type: 'SESSION_CLOSED',
        message: `Attendance session is ${occurrence.status.toLowerCase()}. New scans cannot be accepted.`,
        occurrence,
        timestamp,
        rfidUid: cleanUid
      };
      await this.logAttempt(occurrenceId, cleanUid, 'SESSION_CLOSED', result.message);
      return result;
    }

    // 2. Resolve Student by RFID
    const student = await studentService.findStudentByRfid(cleanUid);
    if (!student) {
      const result: AttendanceScanResult = {
        type: 'UNREGISTERED',
        message: `NFC card [${cleanUid}] is not registered to any student.`,
        occurrence,
        timestamp,
        rfidUid: cleanUid
      };
      await this.logAttempt(occurrenceId, cleanUid, 'UNREGISTERED', result.message);
      return result;
    }

    const studentFullName = formatFullName(student.firstName, student.middleName, student.lastName);

    // 3. Resolve participant record
    const participants = await this.repo.getParticipants(occurrenceId);
    const participant = participants.find(p => p.studentId === student.id);

    if (!participant) {
      const result: AttendanceScanResult = {
        type: 'NOT_ELIGIBLE',
        message: `${studentFullName} (${student.section || 'Unknown Section'}) is not part of the required audience for this event.`,
        student,
        occurrence,
        timestamp,
        rfidUid: cleanUid
      };
      await this.logAttempt(occurrenceId, cleanUid, 'NOT_ELIGIBLE', result.message, student.id, studentFullName);
      return result;
    }

    // 4. Duplicate Check
    if (participant.attendanceStatus === 'PRESENT' || participant.attendanceStatus === 'LATE') {
      const result: AttendanceScanResult = {
        type: 'DUPLICATE',
        message: `${studentFullName} is already recorded as ${participant.attendanceStatus}.`,
        student,
        occurrence,
        participant,
        attendanceStatus: participant.attendanceStatus,
        timestamp,
        rfidUid: cleanUid
      };
      await this.logAttempt(occurrenceId, cleanUid, 'DUPLICATE', result.message, student.id, studentFullName, participant.attendanceStatus);
      return result;
    }

    // 5. Evaluate Present vs Late
    let determinedStatus: AttendanceStatus = 'PRESENT';
    if (occurrence.date && occurrence.startTime) {
      const isLate = isPastTime(occurrence.date, occurrence.startTime, occurrence.gracePeriodMinutes || 15);
      if (isLate) {
        determinedStatus = 'LATE';
      }
    }

    // 6. Persist Official Attendance Record
    const updatedParticipant: OccurrenceParticipant = {
      ...participant,
      attendanceStatus: determinedStatus,
      attendanceTime: timestamp,
      attendanceMethod: 'NFC',
      updatedAt: timestamp
    };

    await this.repo.saveParticipant(updatedParticipant);

    // 7. Log accepted scan
    const message = determinedStatus === 'LATE'
      ? `Checked in LATE (Grace period passed)`
      : `Checked in successfully (PRESENT)`;

    await this.logAttempt(occurrenceId, cleanUid, 'ACCEPTED', message, student.id, studentFullName, determinedStatus);

    return {
      type: 'ACCEPTED',
      message: `${studentFullName} checked in as ${determinedStatus}!`,
      student,
      occurrence,
      participant: updatedParticipant,
      attendanceStatus: determinedStatus,
      timestamp,
      rfidUid: cleanUid
    };
  }

  private async logAttempt(
    occurrenceId: string,
    rfidUid: string,
    result: ScanResultType,
    message: string,
    studentId?: string,
    studentName?: string,
    attendanceStatus?: AttendanceStatus
  ): Promise<void> {
    const log: AttendanceScanLog = {
      id: generateLogId(),
      occurrenceId,
      studentId,
      studentName,
      rfidUid,
      result,
      attendanceStatus,
      timestamp: new Date().toISOString(),
      note: message
    };
    await this.repo.addScanLog(log);
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
