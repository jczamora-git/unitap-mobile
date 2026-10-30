import { localStudentRepository } from './student-storage.service';
import { localEventRepository } from '@/storage/event-storage.service';
import { localFinanceRepository } from '@/storage/finance-storage.service';
import type { Student } from '@/types/student';
import type { Event, EventOccurrence, OccurrenceParticipant } from '@/types/event';
import type { StudentCharge, Wallet, WalletTransaction } from '@/types/finance';

export class DemoDataService {
  async isDemoDataLoaded(): Promise<boolean> {
    const students = await localStudentRepository.getAll();
    return students.some(s => s.id.startsWith('demo_stu_'));
  }

  async loadSampleData(): Promise<{ studentsAdded: number; eventsAdded: number }> {
    const now = new Date().toISOString();
    const today = new Date().toISOString().split('T')[0];

    // 1. Check idempotency for students
    const existingStudents = await localStudentRepository.getAll();
    const existingDemoStudentIds = new Set(existingStudents.filter(s => s.id.startsWith('demo_stu_')).map(s => s.id));

    const demoStudents: Student[] = [
      {
        id: 'demo_stu_1',
        studentNumber: '2023-10001',
        firstName: 'Juan',
        middleName: 'M.',
        lastName: 'Dela Cruz',
        yearLevel: 3,
        section: 'BSIT-3A',
        course: 'BSIT',
        status: 'ACTIVE',
        rfidUid: null,
        rfidUidCompact: null,
        cards: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'demo_stu_2',
        studentNumber: '2023-10002',
        firstName: 'Maria',
        middleName: 'Santos',
        lastName: 'Clara',
        yearLevel: 3,
        section: 'BSIT-3A',
        course: 'BSIT',
        status: 'ACTIVE',
        rfidUid: null,
        rfidUidCompact: null,
        cards: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'demo_stu_3',
        studentNumber: '2024-20015',
        firstName: 'Jose',
        middleName: 'P.',
        lastName: 'Rizal',
        yearLevel: 2,
        section: 'BSIT-2B',
        course: 'BSIT',
        status: 'ACTIVE',
        rfidUid: null,
        rfidUidCompact: null,
        cards: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'demo_stu_4',
        studentNumber: '2025-30042',
        firstName: 'Andres',
        middleName: 'C.',
        lastName: 'Bonifacio',
        yearLevel: 1,
        section: 'BSIT-1A',
        course: 'BSIT',
        status: 'ACTIVE',
        rfidUid: null,
        rfidUidCompact: null,
        cards: [],
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'demo_stu_5',
        studentNumber: '2022-00511',
        firstName: 'Gabriela',
        middleName: 'S.',
        lastName: 'Silang',
        yearLevel: 4,
        section: 'BSIT-4A',
        course: 'BSIT',
        status: 'ACTIVE',
        rfidUid: null,
        rfidUidCompact: null,
        cards: [],
        createdAt: now,
        updatedAt: now
      }
    ];

    let studentsAdded = 0;
    for (const s of demoStudents) {
      if (!existingDemoStudentIds.has(s.id)) {
        await localStudentRepository.save(s);
        studentsAdded++;
      }
    }

    // 2. Seed Events and Occurrences
    const eventStore = await localEventRepository.getData();
    let eventsAdded = 0;

    if (!eventStore.events.some(e => e.id === 'demo_evt_assembly')) {
      const demoEvent1: Event = {
        id: 'demo_evt_assembly',
        title: 'BSIT General Assembly 2026',
        description: 'Semester opening meeting for all Computer Studies students.',
        type: 'General Assembly',
        audience: { type: 'ALL_BSIT' },
        attendanceRequired: true,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      };

      const demoOcc1: EventOccurrence = {
        id: 'demo_occ_assembly_am',
        eventId: 'demo_evt_assembly',
        title: 'Morning Session',
        date: today,
        startTime: '08:00',
        endTime: '12:00',
        gracePeriodMinutes: 15,
        status: 'OPEN',
        openedAt: now,
        createdAt: now
      };

      // Populate expected participants from demo students
      const participants: OccurrenceParticipant[] = [
        {
          id: 'demo_part_1',
          occurrenceId: 'demo_occ_assembly_am',
          eventId: 'demo_evt_assembly',
          studentId: 'demo_stu_1',
          attendanceStatus: 'PENDING',
          updatedAt: now
        },
        {
          id: 'demo_part_2',
          occurrenceId: 'demo_occ_assembly_am',
          eventId: 'demo_evt_assembly',
          studentId: 'demo_stu_2',
          attendanceStatus: 'PENDING',
          updatedAt: now
        },
        {
          id: 'demo_part_3',
          occurrenceId: 'demo_occ_assembly_am',
          eventId: 'demo_evt_assembly',
          studentId: 'demo_stu_3',
          attendanceStatus: 'PENDING',
          updatedAt: now
        },
        {
          id: 'demo_part_4',
          occurrenceId: 'demo_occ_assembly_am',
          eventId: 'demo_evt_assembly',
          studentId: 'demo_stu_4',
          attendanceStatus: 'PENDING',
          updatedAt: now
        },
        {
          id: 'demo_part_5',
          occurrenceId: 'demo_occ_assembly_am',
          eventId: 'demo_evt_assembly',
          studentId: 'demo_stu_5',
          attendanceStatus: 'PENDING',
          updatedAt: now
        }
      ];

      eventStore.events.unshift(demoEvent1);
      eventStore.occurrences.unshift(demoOcc1);
      eventStore.participants.push(...participants);
      eventsAdded++;
    }

    if (!eventStore.events.some(e => e.id === 'demo_evt_cleanup')) {
      const demoEvent2: Event = {
        id: 'demo_evt_cleanup',
        title: 'Campus Cleanup Drive',
        description: 'Mandatory civic action program for 1st & 2nd year students.',
        type: 'Cleanup Drive',
        audience: { type: 'YEAR_LEVEL', yearLevels: [1, 2] },
        attendanceRequired: true,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      };

      const demoOcc2: EventOccurrence = {
        id: 'demo_occ_cleanup_sat',
        eventId: 'demo_evt_cleanup',
        title: 'Weekend Clean-up',
        date: today,
        startTime: '07:00',
        endTime: '11:00',
        gracePeriodMinutes: 15,
        status: 'SCHEDULED',
        createdAt: now
      };

      eventStore.events.unshift(demoEvent2);
      eventStore.occurrences.unshift(demoOcc2);
      eventsAdded++;
    }

    await localEventRepository.getData(); // ensure loaded
    // Commit events
    const currentEvents = await localEventRepository.getEvents();
    if (!currentEvents.some(e => e.id === 'demo_evt_assembly')) {
      for (const e of eventStore.events) {
        await localEventRepository.saveEvent(e);
      }
      for (const o of eventStore.occurrences) {
        await localEventRepository.saveOccurrence(o);
      }
      await localEventRepository.saveParticipants(eventStore.participants);
    }

    // 3. Seed Finance Store (Templates, Charges, Wallets)
    const finStore = await localFinanceRepository.getData();
    if (!finStore.charges.some(c => c.id === 'demo_chg_1')) {
      const demoCharges: StudentCharge[] = [
        {
          id: 'demo_chg_1',
          studentId: 'demo_stu_1',
          chargeTemplateId: 'tmpl_cleanup',
          title: 'Cleanup Drive Absence',
          chargeType: 'FINE',
          issuedAmount: 2000, // ₱20.00
          paidAmount: 0,
          status: 'UNPAID',
          issuedAt: now,
          updatedAt: now
        },
        {
          id: 'demo_chg_2',
          studentId: 'demo_stu_1',
          chargeTemplateId: 'tmpl_sportsfest',
          title: 'Sportsfest Contribution',
          chargeType: 'CONTRIBUTION',
          issuedAmount: 2500, // ₱25.00
          paidAmount: 0,
          status: 'UNPAID',
          issuedAt: now,
          updatedAt: now
        },
        {
          id: 'demo_chg_3',
          studentId: 'demo_stu_2',
          chargeTemplateId: 'tmpl_teachers_day',
          title: "Teacher's Day Contribution",
          chargeType: 'CONTRIBUTION',
          issuedAmount: 2500, // ₱25.00
          paidAmount: 0,
          status: 'UNPAID',
          issuedAt: now,
          updatedAt: now
        }
      ];

      // Give demo_stu_1 a wallet with ₱100.00 credits
      const demoWallet: Wallet = {
        id: 'demo_wal_1',
        studentId: 'demo_stu_1',
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now
      };

      const demoTxn: WalletTransaction = {
        id: 'demo_txn_topup_1',
        walletId: 'demo_wal_1',
        studentId: 'demo_stu_1',
        type: 'TOP_UP',
        amount: 10000, // ₱100.00
        referenceNumber: 'DEMO-TOPUP-100',
        description: 'Initial Demo Credits',
        createdAt: now
      };

      finStore.charges.unshift(...demoCharges);
      if (!finStore.wallets.some(w => w.studentId === 'demo_stu_1')) {
        finStore.wallets.unshift(demoWallet);
        finStore.transactions.unshift(demoTxn);
      }
      await localFinanceRepository.saveData(finStore);
    }

    return { studentsAdded, eventsAdded };
  }

  async resetSampleData(): Promise<void> {
    // 1. Remove only demo students from student store
    const students = await localStudentRepository.getAll();
    const nonDemoStudents = students.filter(s => !s.id.startsWith('demo_stu_'));
    await localStudentRepository.saveAll(nonDemoStudents);

    // 2. Remove demo events and occurrences
    const eventStore = await localEventRepository.getData();
    eventStore.events = eventStore.events.filter(e => !e.id.startsWith('demo_evt_'));
    eventStore.occurrences = eventStore.occurrences.filter(o => !o.id.startsWith('demo_occ_'));
    eventStore.participants = eventStore.participants.filter(p => !p.id.startsWith('demo_part_'));
    eventStore.scanLogs = eventStore.scanLogs.filter(l => !l.id.startsWith('demo_log_'));
    await localEventRepository.resetAll();
    // restore non-demo events
    for (const e of eventStore.events) await localEventRepository.saveEvent(e);
    for (const o of eventStore.occurrences) await localEventRepository.saveOccurrence(o);
    await localEventRepository.saveParticipants(eventStore.participants);

    // 3. Remove demo charges and wallets
    const finStore = await localFinanceRepository.getData();
    finStore.charges = finStore.charges.filter(c => !c.id.startsWith('demo_chg_'));
    finStore.wallets = finStore.wallets.filter(w => !w.id.startsWith('demo_wal_'));
    finStore.transactions = finStore.transactions.filter(t => !t.id.startsWith('demo_txn_'));
    finStore.payments = finStore.payments.filter(p => !p.id.startsWith('demo_pay_'));
    await localFinanceRepository.saveData(finStore);
  }
}

export const demoDataService = new DemoDataService();
