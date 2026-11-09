import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { attendanceService } from '@/services/attendance.service';
import { studentService } from '@/services/student.service';
import { DataModeService } from '@/services/data-mode.service';
import { supabase } from '@/integrations/supabase/client';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { CardsRepository } from '@/database/repositories/cards.repository';
import { EventsRepository } from '@/database/repositories/events.repository';
import { AcademicRepository } from '@/database/repositories/academic.repository';
import { getStudentInitials } from '@/utilities/student-formatters';
import { localStudentRepository } from '@/services/student-storage.service';

describe('UniTap 2.0 Attendance NFC Recognition & Student Photo Verification', () => {
  const semesterId = 'sem_att_nfc_photo';
  const eventId = 'ev_att_nfc_photo';
  const occurrenceId = 'occ_att_nfc_photo';
  const studentId = 'stu_att_nfc_photo_1';
  const formattedUid = '04:A7:32:91';
  const compactUid = '04A73291';

  beforeEach(async () => {
    await resetDatabaseForTests();
    localStudentRepository.clearCache();
    vi.restoreAllMocks();

    const db = await getDatabase();
    await db.execute(
      `INSERT INTO users (id, username, account_status, created_at, updated_at)
       VALUES ('officer_att_1', 'officer1', 'ACTIVE', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`
    );

    await AcademicRepository.createYear({
      id: 'ay_photo_test',
      label: '2026-2027',
      starts_on: '2026-08-01',
      ends_on: '2027-05-31',
      status: 'ACTIVE',
    });
    await AcademicRepository.createSemester({
      id: semesterId,
      academic_year_id: 'ay_photo_test',
      term: 'FIRST',
      starts_on: '2026-08-01',
      ends_on: '2026-12-31',
      status: 'ACTIVE',
    });

    await StudentsRepository.createStudent({
      id: studentId,
      school_id: '2026-9999',
      first_name: 'Jose',
      middle_name: 'Protacio',
      last_name: 'Rizal',
      photo_local_uri: 'file:///data/user/0/com.unitap.app/files/photos/rizal.jpg',
      photo_storage_path: 'students/stu_1/avatar.jpg',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Register card with formatted UID (with colons)
    await CardsRepository.assignCard({
      id: 'card_rizal_active',
      student_id: studentId,
      uid_normalized: formattedUid,
      status: 'ACTIVE',
      assigned_at: new Date().toISOString(),
    });

    await EventsRepository.createEvent({
      id: eventId,
      semester_id: semesterId,
      title: 'University Convocation 2026',
      event_type: 'ASSEMBLY',
      audience_type: 'ALL',
      audience_json: '{}',
      attendance_required: 1,
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    await EventsRepository.createOccurrence({
      id: occurrenceId,
      event_id: eventId,
      title: 'Morning Session',
      occurs_on: localDateStr,
      starts_at: '00:00',
      ends_at: '23:59',
      grace_minutes: 30,
      status: 'OPEN',
      checkpoints_json: JSON.stringify([
        { id: 'cp_in_1', label: 'Morning IN', type: 'IN', opensAt: '00:00', closesAt: '23:59', orderIndex: 0 },
        { id: 'cp_out_1', label: 'Morning OUT', type: 'OUT', opensAt: '00:00', closesAt: '23:59', orderIndex: 1 },
      ]),
      updated_at: new Date().toISOString(),
    });
  });

  it('unifies NFC identification: recognizes card whether scanned as compact hex or colon-formatted', async () => {
    // 1. Scan with compact UID when database has colon-formatted UID
    const lookupCompact = await studentService.lookupCard(compactUid);
    expect(lookupCompact.status).toBe('ACTIVE');
    expect(lookupCompact.student).not.toBeNull();
    expect(lookupCompact.student?.lastName).toBe('Rizal');

    // 2. Scan with formatted UID
    const lookupFormatted = await studentService.lookupCard(formattedUid);
    expect(lookupFormatted.status).toBe('ACTIVE');
    expect(lookupFormatted.student).not.toBeNull();
    expect(lookupFormatted.student?.id).toBe(studentId);

    // 3. Attendance scanner prepareNfcVerification recognizes both identically
    const prepCompact = await attendanceService.prepareNfcVerification(occurrenceId, compactUid, 'officer_att_1', 'cp_in_1');
    expect(prepCompact.type).toBe('ACCEPTED');
    expect(prepCompact.eligible).toBe(true);
    expect(prepCompact.studentFullName).toContain('Rizal');
    expect(prepCompact.checkpointLabel).toBe('Morning IN');

    const prepFormatted = await attendanceService.prepareNfcVerification(occurrenceId, formattedUid, 'officer_att_1', 'cp_in_1');
    expect(prepFormatted.type).toBe('ACCEPTED');
    expect(prepFormatted.eligible).toBe(true);
    expect(prepFormatted.studentFullName).toContain('Rizal');
  });

  it('distinguishes UNREGISTERED cards from INVALID cards', async () => {
    // A. Truly unregistered card
    const unregPrep = await attendanceService.prepareNfcVerification(occurrenceId, 'DEADBEEF99', 'officer_att_1', 'cp_in_1');
    expect(unregPrep.type).toBe('UNREGISTERED');
    expect(unregPrep.eligible).toBe(false);

    // B. Assign another student with an inactive card (LOST/DEACTIVATED)
    const inactiveStudentId = 'stu_inactive_card';
    await StudentsRepository.createStudent({
      id: inactiveStudentId,
      school_id: '2026-8888',
      first_name: 'Andres',
      last_name: 'Bonifacio',
      status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const inactiveCardUid = '04B2C3D4E5F6';
    const db = await getDatabase();
    await db.execute(
      `INSERT INTO nfc_cards (id, student_id, uid_normalized, status, assigned_at)
       VALUES ('card_inactive_1', ?, ?, 'DEACTIVATED', ?)`,
      [inactiveStudentId, inactiveCardUid, new Date().toISOString()]
    );

    const inactivePrep = await attendanceService.prepareNfcVerification(occurrenceId, inactiveCardUid, 'officer_att_1', 'cp_in_1');
    expect(inactivePrep.type).toBe('INVALID');
    expect(inactivePrep.message).toContain('DEACTIVATED');
    expect(inactivePrep.eligible).toBe(false);
  });

  it('propagates real Supabase query errors rather than reporting false UNREGISTERED', async () => {
    vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(true);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      if (table === 'event_occurrences') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: occurrenceId,
                  status: 'OPEN',
                  occurs_on: localDateStr,
                  starts_at: '00:00',
                  ends_at: '23:59',
                  checkpoints_json: JSON.stringify([
                    { id: 'cp_in_1', label: 'Morning IN', type: 'IN', opensAt: '00:00', closesAt: '23:59', orderIndex: 0 },
                  ]),
                },
                error: null,
              }),
            }),
          }),
        } as any;
      }

      if (table === 'nfc_cards') {
        return {
          select: vi.fn().mockImplementation(() =>
            Promise.resolve({
              data: null,
              error: { message: 'JWT expired / connection timeout', code: 'PGRST301' },
            })
          ),
        } as any;
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      } as any;
    });

    // In Direct Supabase mode, an authoritative lookup failure must throw real error
    await expect(
      attendanceService.prepareNfcVerification(occurrenceId, compactUid, 'officer_att_1', 'cp_in_1')
    ).rejects.toThrow('JWT expired / connection timeout');

    fromSpy.mockRestore();
  });

  it('generates student initials fallback correctly', () => {
    expect(getStudentInitials('Jose Rizal')).toBe('JR');
    expect(getStudentInitials('Jose', 'Rizal')).toBe('JR');
    expect(getStudentInitials('Bonifacio')).toBe('BO');
    expect(getStudentInitials('')).toBe('ST');
  });

  it('populates full student photo and academic metadata in verification prompt', async () => {
    const prep = await attendanceService.prepareNfcVerification(occurrenceId, formattedUid, 'officer_att_1', 'cp_in_1');

    expect(prep.type).toBe('ACCEPTED');
    expect(prep.photoLocalUri).toBe('file:///data/user/0/com.unitap.app/files/photos/rizal.jpg');
    expect(prep.schoolId).toBe('2026-9999');
    expect(prep.checkpointId).toBe('cp_in_1');
    expect(prep.checkpointLabel).toBe('Morning IN');
    expect(prep.checkpointType).toBe('IN');
  });
});
