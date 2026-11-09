import type { YearLevel } from '@/types/student';

/**
 * Formats a student's full name properly without double spaces.
 * Example: "Juan", "Santos", "Dela Cruz" -> "Juan Santos Dela Cruz"
 * Example: "Juan", "", "Dela Cruz" -> "Juan Dela Cruz"
 */
export function formatFullName(
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null
): string {
  const parts = [firstName?.trim(), middleName?.trim(), lastName?.trim()].filter(
    (part): part is string => Boolean(part && part.length > 0)
  );
  return parts.join(' ') || 'Unnamed Student';
}

/**
 * Formats numeric YearLevel to user-friendly label.
 */
export function formatYearLevel(yearLevel?: YearLevel | number | null): string {
  switch (yearLevel) {
    case 1:
      return '1st Year';
    case 2:
      return '2nd Year';
    case 3:
      return '3rd Year';
    case 4:
      return '4th Year';
    default:
      return yearLevel ? `${yearLevel}th Year` : 'Unknown Year';
  }
}

/**
 * Generates uppercase 1- or 2-letter initials for avatar placeholders.
 * Example: "Juan", "Dela Cruz" -> "JD"
 * Example: "Juan Dela Cruz" -> "JD"
 */
export function getStudentInitials(
  firstNameOrFullName?: string | null,
  lastName?: string | null
): string {
  if (!firstNameOrFullName) return 'ST';
  if (lastName) {
    const f = firstNameOrFullName.trim()[0] || '';
    const l = lastName.trim()[0] || '';
    return (f + l).toUpperCase() || 'ST';
  }
  const clean = firstNameOrFullName.trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const f = parts[0][0] || '';
    const l = parts[parts.length - 1][0] || '';
    return (f + l).toUpperCase() || 'ST';
  }
  return clean.substring(0, 2).toUpperCase() || 'ST';
}

/**
 * Returns a concise academic summary line for cards and headers.
 * Example: "BSIT • 3rd Year • Section A"
 */
export function formatStudentAcademicSummary(student: {
  course?: string | null;
  yearLevel?: YearLevel | number | null;
  section?: string | null;
}): string {
  const course = student.course?.trim() || 'BSIT';
  const year = formatYearLevel(student.yearLevel);
  const section = student.section?.trim() ? `Section ${student.section.trim()}` : '';

  return [course, year, section].filter(Boolean).join(' • ');
}
