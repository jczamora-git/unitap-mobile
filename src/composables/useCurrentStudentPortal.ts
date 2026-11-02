import { ref, computed } from 'vue';
import type { Student } from '@/types/student';
import type { PaymentRecord } from '@/types/database';
import type { StudentObligationWithBalance } from '@/database/repositories/finance.repository';
import type { Event, EventOccurrence } from '@/types/event';
import { authService } from '@/services/auth.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { studentService } from '@/services/student.service';
import { eventService } from '@/services/event.service';
import { AttendanceRepository } from '@/database/repositories/attendance.repository';
import { FinanceRepository } from '@/database/repositories/finance.repository';
import { formatStudentAcademicSummary, formatFullName } from '@/utilities/student-formatters';

export interface StudentPortalEventItem {
  eventId: string;
  occurrenceId: string;
  eventTitle: string;
  occurrenceTitle: string;
  date: string;
  startTime?: string;
  endTime?: string;
  venue?: string;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'UPCOMING';
  checkedInAt?: string | null;
  method?: string | null;
}

export interface StudentPortalActivity {
  id: string;
  type: 'ATTENDANCE' | 'PAYMENT';
  title: string;
  subtitle: string;
  date: string;
  status?: string;
  badgeClass?: string;
  amountCentavos?: number;
}

const currentStudent = ref<Student | null>(null);
const obligations = ref<StudentObligationWithBalance[]>([]);
const payments = ref<PaymentRecord[]>([]);
const portalEvents = ref<StudentPortalEventItem[]>([]);
const recentActivity = ref<StudentPortalActivity[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

export function useCurrentStudentPortal() {
  const isStudent = computed(() => {
    const role = authService.role.value || SupabaseAuthService.role.value;
    return role === 'STUDENT';
  });

  const studentName = computed(() => {
    if (!currentStudent.value) return 'Student';
    return formatFullName(
      currentStudent.value.firstName,
      currentStudent.value.middleName,
      currentStudent.value.lastName
    );
  });

  const academicSummary = computed(() => {
    if (!currentStudent.value) return '';
    return formatStudentAcademicSummary(currentStudent.value);
  });

  const totalAssessedCentavos = computed(() => {
    return obligations.value.reduce((sum: number, o: StudentObligationWithBalance) => sum + (o.assessed_centavos || 0), 0);
  });

  const totalPaidCentavos = computed(() => {
    return obligations.value.reduce((sum: number, o: StudentObligationWithBalance) => sum + (o.paid_centavos || 0), 0);
  });

  const outstandingBalanceCentavos = computed(() => {
    return obligations.value.reduce((sum: number, o: StudentObligationWithBalance) => sum + (o.balance_centavos || 0), 0);
  });

  const attendedCount = computed(() => {
    return portalEvents.value.filter((e) => e.status === 'PRESENT' || e.status === 'LATE').length;
  });

  const missedCount = computed(() => {
    return portalEvents.value.filter((e) => e.status === 'ABSENT').length;
  });

  const upcomingCount = computed(() => {
    return portalEvents.value.filter((e) => e.status === 'UPCOMING').length;
  });

  const totalCompletedEvents = computed(() => {
    return attendedCount.value + missedCount.value;
  });

  const attendanceRate = computed(() => {
    if (totalCompletedEvents.value === 0) return 100;
    return Math.round((attendedCount.value / totalCompletedEvents.value) * 100);
  });

  async function resolveCurrentStudent(): Promise<Student | null> {
    const authStudent = authService.student.value;
    const authUser = authService.user.value || SupabaseAuthService.user.value;

    let candidate: Student | null = null;

    if (authStudent?.id) {
      candidate = await studentService.getStudent(authStudent.id);
    }

    if (!candidate && authUser?.student_id) {
      candidate = await studentService.getStudent(authUser.student_id);
    }

    if (!candidate && authUser?.username) {
      candidate = await studentService.findStudentByStudentNumber(authUser.username);
    }

    if (candidate) {
      currentStudent.value = candidate;
    }
    return candidate;
  }

  async function loadPortalData() {
    isLoading.value = true;
    error.value = null;

    try {
      const student = await resolveCurrentStudent();
      if (!student) {
        isLoading.value = false;
        return;
      }

      // 1. Obligations & Dues
      const obs = await FinanceRepository.getStudentObligations(student.id);
      obligations.value = obs;

      // 2. Payments
      const pays = await FinanceRepository.getPaymentsByStudent(student.id);
      payments.value = pays;

      // 3. Events & Occurrences
      const allEvents = await eventService.getEvents();
      const allOccurrences = await eventService.getOccurrences();

      // 4. Attendance Records
      const attHistory = await AttendanceRepository.getStudentAttendanceHistory(student.id);
      const attMap = new Map<string, typeof attHistory[0]>();
      for (const rec of attHistory) {
        attMap.set(rec.occurrence_id, rec);
      }

      const eventsList: StudentPortalEventItem[] = [];
      const nowIso = new Date().toISOString();

      for (const occ of allOccurrences) {
        const parentEvent = allEvents.find((e) => e.id === occ.eventId);
        const title = parentEvent ? parentEvent.title : 'Campus Event';
        const occRecord = attMap.get(occ.id);

        let status: 'PRESENT' | 'LATE' | 'ABSENT' | 'UPCOMING' = 'UPCOMING';
        let checkedInAt: string | null = null;
        let method: string | null = null;

        if (occRecord) {
          checkedInAt = occRecord.checked_in_at || null;
          method = occRecord.method || null;
          if (occRecord.status === 'LATE') {
            status = 'LATE';
          } else if (occRecord.status === 'ABSENT') {
            status = 'ABSENT';
          } else {
            status = 'PRESENT';
          }
        } else if (occ.status === 'CLOSED' || (occ.date && occ.date < nowIso.substring(0, 10))) {
          status = 'ABSENT';
        } else {
          status = 'UPCOMING';
        }

        eventsList.push({
          eventId: occ.eventId,
          occurrenceId: occ.id,
          eventTitle: title,
          occurrenceTitle: occ.title || 'Attendance Session',
          date: occ.date,
          startTime: occ.startTime,
          endTime: occ.endTime,
          venue: 'Campus Grounds',
          status,
          checkedInAt,
          method,
        });
      }

      // Sort events: upcoming first, then recent
      eventsList.sort((a, b) => {
        if (a.status === 'UPCOMING' && b.status !== 'UPCOMING') return -1;
        if (b.status === 'UPCOMING' && a.status !== 'UPCOMING') return 1;
        return (b.date || '').localeCompare(a.date || '');
      });

      portalEvents.value = eventsList;

      // 5. Recent Activity synthesis
      const activity: StudentPortalActivity[] = [];

      // Attendance check-ins
      for (const att of attHistory) {
        if (att.checked_in_at) {
          activity.push({
            id: `act_att_${att.id}`,
            type: 'ATTENDANCE',
            title: att.event_title || 'Campus Event',
            subtitle: `Checked in (${att.status}) • ${att.occurrence_title || 'Session'}`,
            date: att.checked_in_at,
            status: att.status,
            badgeClass: att.status === 'PRESENT' ? 'badge-aurora-mint' : 'badge-warning',
          });
        }
      }

      // Payments made
      for (const p of pays) {
        activity.push({
          id: `act_pay_${p.id}`,
          type: 'PAYMENT',
          title: `Payment: ₱${(p.amount_centavos / 100).toFixed(2)}`,
          subtitle: `Ref: ${p.reference_number || 'N/A'} • Method: ${p.source}`,
          date: p.processed_at,
          status: p.status,
          badgeClass: p.status === 'POSTED' ? 'badge-success' : 'badge-danger',
          amountCentavos: p.amount_centavos,
        });
      }

      // Sort activity descending by date
      activity.sort((a, b) => b.date.localeCompare(a.date));
      recentActivity.value = activity.slice(0, 8);
    } catch (err: unknown) {
      console.error('[useCurrentStudentPortal] Error loading data:', err);
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      isLoading.value = false;
    }
  }

  return {
    isStudent,
    student: currentStudent,
    studentName,
    academicSummary,
    obligations,
    payments,
    portalEvents,
    recentActivity,
    isLoading,
    error,
    totalAssessedCentavos,
    totalPaidCentavos,
    outstandingBalanceCentavos,
    attendedCount,
    missedCount,
    upcomingCount,
    totalCompletedEvents,
    attendanceRate,
    loadPortalData,
    resolveCurrentStudent,
  };
}

