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
