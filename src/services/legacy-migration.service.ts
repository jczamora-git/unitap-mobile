import { Preferences } from '@capacitor/preferences';
import { getDatabase } from '../database/database';
import { AcademicRepository } from '../database/repositories/academic.repository';
import { StudentsRepository } from '../database/repositories/students.repository';
import { CardsRepository } from '../database/repositories/cards.repository';
import { EventsRepository } from '../database/repositories/events.repository';
import { AttendanceRepository } from '../database/repositories/attendance.repository';
import { FinanceRepository } from '../database/repositories/finance.repository';
import type { Student } from '@/types/student';
import type { EventDataStore } from '@/storage/event-storage.service';
import type { FinanceDataStore } from '@/storage/finance-storage.service';

export interface MigrationSummary {
  success: boolean;
  studentsMigrated: number;
  eventsMigrated: number;
  obligationsMigrated: number;
  paymentsMigrated: number;
  errors: string[];
}

export class LegacyMigrationService {
  private static MIGRATION_FLAG_KEY = 'unitap_v2_migration_completed';
  private static BACKUP_KEY = 'unitap_legacy_backup_timestamp';

  public static async isMigrationCompleted(): Promise<boolean> {
    const { value } = await Preferences.get({ key: this.MIGRATION_FLAG_KEY });
    return value === 'true';
  }

  public static async runMigrationIfNeeded(): Promise<MigrationSummary> {
    const isDone = await this.isMigrationCompleted();
    if (isDone) {
      return {
        success: true,
        studentsMigrated: 0,
        eventsMigrated: 0,
        obligationsMigrated: 0,
        paymentsMigrated: 0,
        errors: [],
      };
    }

    return this.migrate();
  }

  public static async migrate(): Promise<MigrationSummary> {
    const summary: MigrationSummary = {
      success: false,
      studentsMigrated: 0,
      eventsMigrated: 0,
      obligationsMigrated: 0,
      paymentsMigrated: 0,
      errors: [],
    };

    const db = await getDatabase();

    try {
      // 1. Create protected backup in Preferences
      const now = new Date().toISOString();
      const rawStudents = (await Preferences.get({ key: 'nfc_inspector_students_v1' })).value;
      const rawEvents = (await Preferences.get({ key: 'unitap_events_v1' })).value;
      const rawFinance = (await Preferences.get({ key: 'unitap_finance_v1' })).value;

      // If no legacy stores exist in Preferences, nothing to migrate; mark completed
      if (!rawStudents && !rawEvents && !rawFinance) {
        await Preferences.set({ key: this.MIGRATION_FLAG_KEY, value: 'true' });
        summary.success = true;
        return summary;
      }

      await Preferences.set({ key: 'unitap_backup_students_' + Date.now(), value: rawStudents || '[]' });
      await Preferences.set({ key: 'unitap_backup_events_' + Date.now(), value: rawEvents || '{}' });
      await Preferences.set({ key: 'unitap_backup_finance_' + Date.now(), value: rawFinance || '{}' });
      await Preferences.set({ key: this.BACKUP_KEY, value: now });

      const students: Student[] = rawStudents ? JSON.parse(rawStudents) : [];
      const eventStore: EventDataStore = rawEvents ? JSON.parse(rawEvents) : { events: [], occurrences: [], participants: [], scanLogs: [] };
      const financeStore: FinanceDataStore = rawFinance ? JSON.parse(rawFinance) : { templates: [], charges: [], wallets: [], transactions: [], payments: [] };

      // 2. Perform Migration in a single atomic transaction
      await db.transaction(async (tx) => {
        // A. Ensure active academic year and semester exist
        let activeSem = await AcademicRepository.getActiveSemester(tx);
        let academicYearId = 'ay_2026_2027';
        let semesterId = 'sem_2026_2027_1';

        if (!activeSem) {
          const existingYear = await AcademicRepository.getYearById(academicYearId, tx);
          if (!existingYear) {
            await AcademicRepository.createYear({
              id: academicYearId,
              label: '2026-2027',
              starts_on: '2026-08-01',
              ends_on: '2027-05-31',
              status: 'ACTIVE',
            }, tx);
          }

          await AcademicRepository.createSemester({
            id: semesterId,
            academic_year_id: academicYearId,
            term: 'FIRST',
            starts_on: '2026-08-01',
            ends_on: '2026-12-31',
            status: 'ACTIVE',
          }, tx);
          activeSem = await AcademicRepository.getSemesterById(semesterId, tx);
        } else {
          semesterId = activeSem.id;
          academicYearId = activeSem.academic_year_id;
        }

        // B. Ensure default BSIT program exists
        await AcademicRepository.upsertProgram({
          id: 'prog_bsit',
          code: 'BSIT',
          name: 'Bachelor of Science in Information Technology',
          is_active: 1,
        }, tx);

        // C. Migrate Students & NFC Cards
        for (const s of students) {
          try {
            const schoolId = String(s.studentNumber || s.id).trim();
            if (!schoolId) continue;

            const existing = await StudentsRepository.getStudentBySchoolId(schoolId, tx);
            const studentId = existing ? existing.id : (s.id || 'stu_' + Math.random().toString(36).substring(2, 10));

            if (!existing) {
              const firstName = s.firstName || 'Unknown';
              const lastName = s.lastName || 'Student';

              await StudentsRepository.createStudent({
                id: studentId,
                school_id: schoolId,
                first_name: firstName,
                middle_name: s.middleName || null,
                last_name: lastName,
                photo_local_uri: null,
                status: 'ACTIVE',
                created_at: s.createdAt || now,
                updated_at: s.updatedAt || now,
              }, tx);
              summary.studentsMigrated++;
            }

            // Create student enrollment if not enrolled in current semester
            const existingEnrollment = await AcademicRepository.getStudentEnrollmentInSemester(studentId, semesterId, tx);
            if (!existingEnrollment) {
              const yearLevel = Number(s.yearLevel) >= 1 && Number(s.yearLevel) <= 8 ? Number(s.yearLevel) : 1;
              const section = s.section || '1F4';
              await AcademicRepository.createEnrollment({
                id: 'enr_' + Math.random().toString(36).substring(2, 10),
                student_id: studentId,
                semester_id: semesterId,
                program_id: 'prog_bsit',
                year_level: yearLevel,
                section,
                enrollment_status: 'ENROLLED',
                first_name_snapshot: existing?.first_name || s.firstName || 'Student',
                middle_name_snapshot: existing?.middle_name || s.middleName || null,
                last_name_snapshot: existing?.last_name || s.lastName || 'Student',
                updated_at: now,
              }, tx);
            }

            // Migrate NFC card
            const rfidUid = s.rfidUidCompact || (s.rfidUid ? s.rfidUid.replace(/[^0-9A-Fa-f]/g, '').toUpperCase() : null);
            if (rfidUid) {
              const existingCard = await CardsRepository.getCardByNormalizedUid(rfidUid, tx);
              if (!existingCard) {
                await CardsRepository.assignCard({
                  id: 'card_' + Math.random().toString(36).substring(2, 10),
                  student_id: studentId,
                  uid_normalized: rfidUid,
                  status: 'ACTIVE',
                  assigned_at: s.createdAt || now,
                }, tx);
              }
            }

            // Create wallet for student
            await FinanceRepository.getOrCreateWallet(studentId, tx);
          } catch (err: unknown) {
            summary.errors.push(`Error migrating student ${s.studentNumber}: ${(err as Error).message}`);
          }
        }

        // D. Migrate Events, Occurrences, and Attendance
        if (eventStore.events) {
          for (const ev of eventStore.events) {
            try {
              const existingEv = await EventsRepository.getEventById(ev.id, tx);
              if (!existingEv) {
                await EventsRepository.createEvent({
                  id: ev.id,
                  semester_id: semesterId,
                  title: ev.title,
                  description: ev.description || null,
                  event_type: ev.type || 'OTHER',
                  audience_type: 'ALL',
                  audience_json: JSON.stringify(ev.audience || {}),
                  attendance_required: 1,
                  status: 'ACTIVE',
                  created_at: ev.createdAt || now,
                  updated_at: ev.updatedAt || now,
                }, tx);
                summary.eventsMigrated++;
              }
            } catch (err: unknown) {
              summary.errors.push(`Error migrating event ${ev.title}: ${(err as Error).message}`);
            }
          }
        }

        if (eventStore.occurrences) {
          for (const occ of eventStore.occurrences) {
            try {
              const existingOcc = await EventsRepository.getOccurrenceById(occ.id, tx);
              if (!existingOcc) {
                await EventsRepository.createOccurrence({
                  id: occ.id,
                  event_id: occ.eventId,
                  title: occ.title || 'Session',
                  occurs_on: occ.date || now.split('T')[0],
                  starts_at: occ.startTime || '08:00',
                  ends_at: occ.endTime || '12:00',
                  grace_minutes: occ.gracePeriodMinutes || 15,
                  status: (occ.status as any) || 'CLOSED',
                  updated_at: now,
                }, tx);
              }
            } catch (err: unknown) {
              summary.errors.push(`Error migrating occurrence ${occ.id}: ${(err as Error).message}`);
            }
          }
        }

        // Migrate Attendance scan logs into attendance_records
        if (eventStore.scanLogs) {
          for (const log of eventStore.scanLogs) {
            try {
              if (!log.studentId) continue;
              const existingRec = await AttendanceRepository.getRecord(log.occurrenceId, log.studentId, tx);
              if (!existingRec) {
                await AttendanceRepository.recordAttendance({
                  id: log.id || 'att_' + Math.random().toString(36).substring(2, 10),
                  occurrence_id: log.occurrenceId,
                  student_id: log.studentId,
                  status: (log.attendanceStatus || (log.result === 'ACCEPTED' ? 'PRESENT' : 'PRESENT')) as any,
                  checked_in_at: log.timestamp || now,
                  method: 'NFC',
                  photo_checked: 0,
                  updated_at: now,
                }, 'system_migration', tx);
              }
            } catch (err: unknown) {
              summary.errors.push(`Error migrating attendance log ${log.id}: ${(err as Error).message}`);
            }
          }
        }

        // E. Migrate Finance (Templates -> Rules, Charges -> Obligations, Wallets)
        if (financeStore.templates) {
          for (const t of financeStore.templates) {
            try {
              await FinanceRepository.createRule({
                id: t.id,
                semester_id: semesterId,
                name: t.name,
                type: (t.chargeType ?? t.type) === 'FINE' ? 'FINE' : 'CONTRIBUTION',
                trigger_type: t.triggerType || 'MANUAL',
                default_amount_centavos: t.defaultAmount ?? t.defaultAmountCentavos ?? 0,
                status: t.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
                created_at: t.createdAt || now,
              }, tx);
            } catch {
              // Ignore duplicate rules
            }
          }
        }

        if (financeStore.charges) {
          for (const ch of financeStore.charges) {
            try {
              await FinanceRepository.assessObligation({
                id: ch.id,
                student_id: ch.studentId,
                semester_id: semesterId,
                rule_id: ch.chargeTemplateId || null,
                title: ch.title,
                type: ch.chargeType === 'FINE' ? 'FINE' : 'CONTRIBUTION',
                amount_centavos: ch.issuedAmount,
                status: ch.status === 'VOID' ? 'VOID' : 'ACTIVE',
                issued_at: ch.issuedAt || now,
                updated_at: ch.updatedAt || now,
              }, tx);
              summary.obligationsMigrated++;
            } catch {
              // Ignore duplicates
            }
          }
        }

        // Migrate Wallet balances from legacy transactions
        if (financeStore.transactions) {
          for (const txn of financeStore.transactions) {
            if (txn.type === 'TOP_UP') {
              try {
                await FinanceRepository.topUpWallet(
                  txn.studentId,
                  txn.amount,
                  'legacy_migration',
                  txn.referenceNumber || ('MIGRATE-TOPUP-' + txn.id),
                  tx
                );
              } catch (err: unknown) {
                summary.errors.push(`Error migrating top-up ${txn.id}: ${(err as Error).message}`);
              }
            }
          }
        }
      });

      // Mark migration completed
      await Preferences.set({ key: this.MIGRATION_FLAG_KEY, value: 'true' });
      summary.success = true;
    } catch (error: unknown) {
      summary.errors.push(`Fatal migration error: ${(error as Error).message}`);
      summary.success = false;
    }

    return summary;
  }
}
