/**
 * UniTap 2.0 Centralized Operation Policy Foundation (Phase 1)
 *
 * Defines operation-level selective offline-first access rules, separating
 * module-viewing policies from mutation policies.
 */

export type OperationType =
  | 'ATTENDANCE_SCAN'
  | 'STUDENTS_READ'
  | 'STUDENTS_CREATE_UPDATE_DEACTIVATE'
  | 'OFFICER_MANAGEMENT_AND_PERMISSIONS'
  | 'STUDENT_ACTIVATION_ACCOUNT_LINKING'
  | 'EVENTS_READ'
  | 'EVENTS_AND_OCCURRENCES_MUTATIONS'
  | 'NFC_CARD_ASSIGNMENT_REASSIGNMENT'
  | 'FINANCE_ASSESSMENTS_AND_RULES'
  | 'PAYMENT_POST_REVERSE_RECEIPT'
  | 'ACADEMIC_SYSTEM_SETUP_MUTATIONS'
  | 'REPORTS_READ';

export type PolicyMode =
  | 'OFFLINE_OUTBOX'
  | 'CACHE_WITH_LIVE_REFRESH'
  | 'ONLINE_CONFIRMED'
  | 'AUTHORIZED_CACHE_ALLOWED';

export interface OperationPolicyDefinition {
  operation: OperationType;
  mode: PolicyMode;
  description: string;
  offlineErrorMessage: string;
}

export const OPERATION_POLICIES: Record<OperationType, OperationPolicyDefinition> = {
  ATTENDANCE_SCAN: {
    operation: 'ATTENDANCE_SCAN',
    mode: 'OFFLINE_OUTBOX',
    description: 'Attendance scan check-ins, rechecks, and overrides with photo verification.',
    offlineErrorMessage: '', // Permitted offline
  },
  STUDENTS_READ: {
    operation: 'STUDENTS_READ',
    mode: 'CACHE_WITH_LIVE_REFRESH',
    description: 'Student directory and profile reading with background refresh.',
    offlineErrorMessage: '', // Permitted from cache
  },
  STUDENTS_CREATE_UPDATE_DEACTIVATE: {
    operation: 'STUDENTS_CREATE_UPDATE_DEACTIVATE',
    mode: 'ONLINE_CONFIRMED',
    description: 'Creating, updating, or deactivating student records.',
    offlineErrorMessage: 'Student record modifications require an active internet connection and live server confirmation.',
  },
  OFFICER_MANAGEMENT_AND_PERMISSIONS: {
    operation: 'OFFICER_MANAGEMENT_AND_PERMISSIONS',
    mode: 'ONLINE_CONFIRMED',
    description: 'Officer appointments, permission presets, suspensions, and revocations.',
    offlineErrorMessage: 'Officer administration and role adjustments require an active connection and live server confirmation.',
  },
  STUDENT_ACTIVATION_ACCOUNT_LINKING: {
    operation: 'STUDENT_ACTIVATION_ACCOUNT_LINKING',
    mode: 'ONLINE_CONFIRMED',
    description: 'Issuing, revoking single-use activation codes, and student account linking.',
    offlineErrorMessage: 'Issuing or revoking student activation codes requires an active connection and live server confirmation.',
  },
  EVENTS_READ: {
    operation: 'EVENTS_READ',
    mode: 'CACHE_WITH_LIVE_REFRESH',
    description: 'Events calendar, occurrences, and session roster inspection.',
    offlineErrorMessage: '', // Permitted from cache
  },
  EVENTS_AND_OCCURRENCES_MUTATIONS: {
    operation: 'EVENTS_AND_OCCURRENCES_MUTATIONS',
    mode: 'ONLINE_CONFIRMED',
    description: 'Creating, updating, or rescheduling events and occurrences.',
    offlineErrorMessage: 'Creating or editing events requires an active connection and live server confirmation.',
  },
  NFC_CARD_ASSIGNMENT_REASSIGNMENT: {
    operation: 'NFC_CARD_ASSIGNMENT_REASSIGNMENT',
    mode: 'ONLINE_CONFIRMED',
    description: 'Assigning, replacing, or deactivating physical NFC cards for students.',
    offlineErrorMessage: 'Physical NFC card assignment requires an active connection to prevent multi-device UID collisions.',
  },
  FINANCE_ASSESSMENTS_AND_RULES: {
    operation: 'FINANCE_ASSESSMENTS_AND_RULES',
    mode: 'ONLINE_CONFIRMED',
    description: 'Creating charge templates and assessing absentee fines.',
    offlineErrorMessage: 'Creating financial charge rules requires an active connection and live server confirmation.',
  },
  PAYMENT_POST_REVERSE_RECEIPT: {
    operation: 'PAYMENT_POST_REVERSE_RECEIPT',
    mode: 'ONLINE_CONFIRMED',
    description: 'Posting official payments, payment reversals, and receipt generation.',
    offlineErrorMessage: 'Posting official payments and reversals requires an active connection and live server confirmation.',
  },
  ACADEMIC_SYSTEM_SETUP_MUTATIONS: {
    operation: 'ACADEMIC_SYSTEM_SETUP_MUTATIONS',
    mode: 'ONLINE_CONFIRMED',
    description: 'Academic years, semesters, categories, year levels, and section setup.',
    offlineErrorMessage: 'System setup modifications require an active connection and DevAdmin cloud authorization.',
  },
  REPORTS_READ: {
    operation: 'REPORTS_READ',
    mode: 'AUTHORIZED_CACHE_ALLOWED',
    description: 'Financial collections, absentee reports, and offline CSV/HTML export.',
    offlineErrorMessage: '', // Permitted from authorized cache
  },
};

export class PolicyViolationError extends Error {
  public readonly code: 'OFFLINE_BLOCKED' | 'SERVER_UNREACHABLE' | 'UNAUTHORIZED' | 'REVOKED';
  public readonly operation: OperationType;
  public readonly mode: PolicyMode;

  constructor(
    code: 'OFFLINE_BLOCKED' | 'SERVER_UNREACHABLE' | 'UNAUTHORIZED' | 'REVOKED',
    operation: OperationType,
    customMessage?: string
  ) {
    const defaultMsg = OPERATION_POLICIES[operation]?.offlineErrorMessage || 'Operation not permitted under current policy.';
    super(customMessage || defaultMsg);
    this.name = 'PolicyViolationError';
    this.code = code;
    this.operation = operation;
    this.mode = OPERATION_POLICIES[operation]?.mode || 'ONLINE_CONFIRMED';
  }
}

export interface OperationEvaluation {
  permitted: boolean;
  mode: PolicyMode;
  code?: 'OK' | 'OFFLINE_BLOCKED' | 'SERVER_UNREACHABLE' | 'UNAUTHORIZED';
  reason?: string;
}

