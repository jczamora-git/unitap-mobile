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
import { supabase } from '@/integrations/supabase/client';
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
const isInitialLoading = ref(true);
const isRefreshing = ref(false);
const isStale = ref(false);
const error = ref<string | null>(null);
let portalRequestId = 0;

export function useCurrentStudentPortal() {
  const isStudent = computed(() => {
    const role = authService.role.value || SupabaseAuthService.role.value;
    return role === 'STUDENT';
  });

  const studentName = computed(() => {
    if (!currentStudent.value) return '';
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

    // 1. Direct active student in auth state (never substitute auth UUID for student UUID)
    if (authStudent?.id && (!authUser?.id || authStudent.id !== authUser.id)) {
      candidate = await studentService.getStudent(authStudent.id);
    }

    // 2. Auth user record with linked student_id
    if (!candidate && authUser?.student_id && (!authUser.id || authUser.student_id !== authUser.id)) {
      candidate = await studentService.getStudent(authUser.student_id);
    }

    // 3. Direct Supabase Mode or Cloud Session Resolution
    if (!candidate) {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const authUserObj = authData?.user;
        const authUid = authUserObj?.id || authUser?.id;

        if (authUid) {
          const { data: userRow } = await supabase
            .from('users')
            .select('student_id, username')
            .eq('id', authUid)
            .maybeSingle();

          // 3.1. If public.users has a linked student_id (protect against auth UUID substitution)
          if (userRow?.student_id && userRow.student_id !== authUid) {
            candidate = await studentService.getStudent(userRow.student_id);
          }

          // 3.2. If public.users.student_id is NULL, resolve using authenticated user's exact user_metadata.school_id
          if (!candidate) {
            const rawSchoolId =
              authUserObj?.user_metadata?.school_id ||
              (authUser as any)?.user_metadata?.school_id;
            const metadataSchoolId =
              typeof rawSchoolId === 'string' && !rawSchoolId.includes('@')
                ? rawSchoolId.trim()
                : null;

            if (metadataSchoolId) {
              const matchedStudent = await studentService.findStudentByStudentNumber(metadataSchoolId);
              // Verify exact match against students.school_id
              if (
                matchedStudent &&
                matchedStudent.studentNumber &&
                matchedStudent.studentNumber.trim().toUpperCase() === metadataSchoolId.toUpperCase()
              ) {
                candidate = matchedStudent;

                // Repair the missing public.users.student_id link only after an exact verified match
                // Ensure candidate.id (student UUID) is saved, NEVER authUid
                if (candidate.id && candidate.id !== authUid) {
                  try {
                    const { error: repairErr } = await supabase
                      .from('users')
                      .update({ student_id: candidate.id })
                      .eq('id', authUid);
                    if (repairErr) {
                      console.warn('[useCurrentStudentPortal] Failed to repair student_id in public.users:', repairErr);
                    } else {
                      console.log(
                        `[useCurrentStudentPortal] Repaired missing student_id link for auth user ${authUid} -> student ${candidate.id}`
                      );
                    }
                  } catch (repairErr) {
                    console.warn('[useCurrentStudentPortal] Failed to repair student_id in public.users:', repairErr);
                  }
                }
              }
            }
          }
        }
      } catch (cloudErr) {
        console.warn('[useCurrentStudentPortal] Cloud user resolution failed:', cloudErr);
      }
    }

    if (candidate) {
      if (!candidate.photoUrl && candidate.photoStoragePath) {
        candidate.photoUrl = (await studentService.resolveStudentPhotoUrl(candidate)) || undefined;
      }
      currentStudent.value = candidate;
      error.value = null;
    } else {
      currentStudent.value = null;
      error.value = 'No student profile is linked to this authenticated account. Please contact an officer to link your student record.';
    }
    return candidate;
  }

  async function loadPortalData() {
    const thisRequestId = ++portalRequestId;
    if (currentStudent.value) {
      isRefreshing.value = true;
    } else {
      isInitialLoading.value = true;
    }
    isLoading.value = true;
    error.value = null;

    try {
      const student = await resolveCurrentStudent();
      if (thisRequestId !== portalRequestId) return;
      if (!student) {
        isLoading.value = false;
        isInitialLoading.value = false;
        isRefreshing.value = false;
        return;
      }

      // 1. Obligations & Dues
      const obs = await FinanceRepository.getStudentObligations(student.id);
      if (thisRequestId !== portalRequestId) return;
      obligations.value = obs;

      // 2. Payments
      const pays = await FinanceRepository.getPaymentsByStudent(student.id);
      if (thisRequestId !== portalRequestId) return;
      payments.value = pays;

      // 3. Events & Occurrences
      const allEvents = await eventService.getEvents();
      const allOccurrences = await eventService.getOccurrences();
      if (thisRequestId !== portalRequestId) return;

      // 4. Attendance Records
      const attHistory = await AttendanceRepository.getStudentAttendanceHistory(student.id);
      if (thisRequestId !== portalRequestId) return;
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
      isStale.value = false;
      error.value = null;
    } catch (err: unknown) {
      console.error('[useCurrentStudentPortal] Error loading data:', err);
      if (thisRequestId === portalRequestId) {
        if (currentStudent.value) {
          isStale.value = true;
        } else {
          error.value = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      if (thisRequestId === portalRequestId) {
        isInitialLoading.value = false;
        isRefreshing.value = false;
        isLoading.value = false;
      }
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
    isInitialLoading,
    isRefreshing,
    isStale,
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

