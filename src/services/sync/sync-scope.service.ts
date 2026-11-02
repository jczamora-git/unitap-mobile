export type UserRole = 'DEVADMIN' | 'OFFICER' | 'STUDENT';

export interface SyncScopeConfig {
  role: UserRole;
  userId: string;
  studentId?: string | null;
  semesterId?: string | null;
  batchSize: number;
}

export class SyncScopeService {
  public static getScopeConfig(
    role: UserRole,
    userId: string,
    studentId?: string | null,
    semesterId?: string | null
  ): SyncScopeConfig {
    return {
      role,
      userId,
      studentId,
      semesterId,
      batchSize: role === 'DEVADMIN' ? 200 : 100,
    };
  }

  /**
   * Returns tables required for hydration based on role.
   * Excludes privileged tables for students in compliance with RA 10173 data minimization.
   */
  public static getRequiredTablesForRole(role: UserRole): string[] {
    switch (role) {
      case 'DEVADMIN':
        return [
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
          'obligation_rules',
          'student_obligations',
          'payments',
          'payment_allocations',
        ];
      case 'OFFICER':
        return [
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
          'obligation_rules',
          'student_obligations',
          'payments',
          'payment_allocations',
        ];
      case 'STUDENT':
        return [
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
          'event_participants',
          'attendance_records',
          'student_obligations',
          'payments',
        ];
    }
  }

  /**
   * Returns scoped query filter to prevent unauthorized data downloads
   */
  public static getTableFilter(
    tableName: string,
    role: UserRole,
    studentId?: string | null
  ): { column: string; value: string } | null {
    if (role === 'STUDENT' && studentId) {
      if (tableName === 'students') {
        return { column: 'id', value: studentId };
      }
      if (
        [
          'student_enrollments',
          'attendance_records',
          'student_obligations',
          'payments',
          'event_participants',
          'nfc_cards',
        ].includes(tableName)
      ) {
        return { column: 'student_id', value: studentId };
      }
    }
    return null;
  }
}
