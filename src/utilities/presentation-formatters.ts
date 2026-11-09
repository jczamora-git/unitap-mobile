/**
 * Centralized presentation-layer formatting utilities for UniTap 2.0.
 * Converts technical database enums and identifiers into clean, user-friendly labels.
 */

export {
  INSTITUTION_CONFIG,
  INSTITUTION_NAME,
  INSTITUTION_COLLEGE,
  INSTITUTION_ORG,
  INSTITUTION_PASS_SUBTITLE,
} from './branding';

/**
 * Format academic semester term (e.g., 'FIRST' -> '1st Semester')
 */
export function formatSemesterName(term?: string | null): string {
  if (!term) return 'Semester Not Set';
  const upper = term.trim().toUpperCase();
  switch (upper) {
    case 'FIRST':
    case '1ST':
    case '1':
      return '1st Semester';
    case 'SECOND':
    case '2ND':
    case '2':
      return '2nd Semester';
    case 'SUMMER':
    case 'MIDYEAR':
      return 'Summer Term';
    default:
      return upper.charAt(0) + upper.slice(1).toLowerCase() + (upper.includes('TERM') || upper.includes('SEM') ? '' : ' Term');
  }
}

/**
 * Format academic year (e.g., 'ay_2026_2027' -> 'A.Y. 2026–2027')
 */
export function formatAcademicYear(year?: string | null): string {
  if (!year) return 'A.Y. Not Configured';
  const trimmed = year.trim();
  
  // Matches 'ay_2026_2027' or 'AY_2026_2027'
  const ayMatch = trimmed.match(/^ay_(\d{4})_(\d{4})$/i);
  if (ayMatch) {
    return `A.Y. ${ayMatch[1]}–${ayMatch[2]}`;
  }

  // Matches '2026-2027' or '2026_2027'
  const rangeMatch = trimmed.match(/^(\d{4})[-_](\d{4})$/);
  if (rangeMatch) {
    return `A.Y. ${rangeMatch[1]}–${rangeMatch[2]}`;
  }

  if (trimmed.startsWith('A.Y.')) {
    return trimmed;
  }

  return `A.Y. ${trimmed}`;
}

/**
 * Combine term and academic year into a single unified label:
 * e.g. '1st Semester • A.Y. 2026–2027'
 */
export function formatAcademicPeriod(term?: string | null, year?: string | null): string {
  const semStr = formatSemesterName(term);
  const yearStr = formatAcademicYear(year);
  return `${semStr} • ${yearStr}`;
}

/**
 * Format numeric year level into friendly ordinal text (e.g. 1 -> '1st Year')
 */
export function formatYearLevel(level?: number | string | null): string {
  if (!level) return 'Year Level Not Set';
  const num = typeof level === 'string' ? parseInt(level, 10) : level;
  switch (num) {
    case 1:
      return '1st Year';
    case 2:
      return '2nd Year';
    case 3:
      return '3rd Year';
    case 4:
      return '4th Year';
    default:
      return isNaN(num) ? String(level) : `${num}th Year`;
  }
}

/**
 * Format user role into a friendly display name (e.g. 'DEVADMIN' -> 'Developer Admin')
 */
export function formatUserRole(role?: string | null): string {
  if (!role) return 'Student';
  const upper = role.trim().toUpperCase();
  switch (upper) {
    case 'DEVADMIN':
      return 'Developer Admin';
    case 'OFFICER':
      return 'Officer';
    case 'STUDENT':
      return 'Student';
    default:
      return upper.charAt(0) + upper.slice(1).toLowerCase();
  }
}

/**
 * Format sync status into human-readable text
 */
export function formatSyncStatus(status?: string | null): string {
  if (!status) return 'Up to Date';
  const upper = status.trim().toUpperCase();
  switch (upper) {
    case 'SYNCED':
      return 'Up to Date';
    case 'PENDING_CHANGES':
    case 'PENDING_SYNC':
      return 'Waiting to Sync';
    case 'SYNCING':
      return 'Syncing...';
    case 'SYNC_ERROR':
      return 'Sync Failed';
    case 'CONFLICT':
      return 'Sync Conflict';
    case 'OFFLINE':
      return 'Offline';
    default:
      return upper;
  }
}

/**
 * Format attendance record status
 */
export function formatAttendanceStatus(status?: string | null): string {
  if (!status) return 'Not Checked In';
  const upper = status.trim().toUpperCase();
  switch (upper) {
    case 'PRESENT':
      return 'Present';
    case 'LATE':
      return 'Late';
    case 'EXCUSED':
      return 'Excused';
    case 'ABSENT':
      return 'Absent';
    case 'UNMARKED':
      return 'Unmarked';
    default:
      return upper.charAt(0) + upper.slice(1).toLowerCase();
  }
}

/**
 * Format financial obligation and fine status
 */
export function formatObligationStatus(status?: string | null): string {
  if (!status) return 'Pending';
  const upper = status.trim().toUpperCase();
  switch (upper) {
    case 'PENDING':
      return 'Pending';
    case 'PAID':
      return 'Paid';
    case 'PARTIALLY_PAID':
      return 'Partially Paid';
    case 'VOID':
    case 'VOIDED':
      return 'Voided';
    case 'CANCELLED':
      return 'Cancelled';
    case 'ALREADY_FINED':
      return 'Fine Already Assigned';
    default:
      return upper.replace(/_/g, ' ');
  }
}

/**
 * Format payment method into readable text
 */
export function formatPaymentMethod(method?: string | null): string {
  if (!method) return 'Cash';
  const upper = method.trim().toUpperCase();
  switch (upper) {
    case 'CASH':
    case 'CASH_RECORDED':
      return 'Cash';
    case 'BANK_TRANSFER':
    case 'MANUAL_TRANSFER_RECORD':
      return 'Bank / E-Wallet Transfer';
    case 'CHECK':
      return 'Check';
    default:
      return 'Recorded Payment';
  }
}

