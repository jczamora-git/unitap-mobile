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
   * Returns tables required for hydration based on role
   */
  public static getRequiredTablesForRole(role: UserRole): string[] {
    switch (role) {
      case 'DEVADMIN':
        return [
          'academic_years',
          'semesters',
          'programs',
          'obligation_rules',
          'events',
          'event_occurrences',
          'students',
          'student_enrollments',
          'nfc_cards',
          'attendance_records',
          'student_obligations',
          'payments',
        ];
      case 'OFFICER':
        return [
          'academic_years',
          'semesters',
          'programs',
          'obligation_rules',
          'students',
          'student_enrollments',
          'nfc_cards',
          'events',
          'event_occurrences',
          'attendance_records',
          'student_obligations',
          'payments',
          'simulated_wallets',
          'simulated_wallet_ledger',
        ];
      case 'STUDENT':
        return [
          'academic_years',
          'semesters',
          'programs',
          'students',
          'student_enrollments',
          'events',
          'event_occurrences',
          'attendance_records',
          'student_obligations',
          'payments',
          'simulated_wallets',
          'simulated_wallet_ledger',
        ];
    }
  }
}

