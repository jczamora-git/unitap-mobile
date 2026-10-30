import { describe, expect, test } from 'vitest';
import { formatPeso, pesoToCentavos, centavosToPeso } from '@/utilities/finance-formatters';
import { formatFullName, formatYearLevel } from '@/utilities/student-formatters';

describe('Utility Formatters', () => {
  test('formats peso amounts properly', () => {
    expect(formatPeso(2500)).toContain('25.00');
    expect(formatPeso(10000)).toContain('100.00');
    expect(pesoToCentavos(25)).toBe(2500);
    expect(centavosToPeso(2500)).toBe(25);
  });

  test('formats student names and year levels', () => {
    expect(formatFullName('Juan', 'Santos', 'Dela Cruz')).toBe('Juan Santos Dela Cruz');
    expect(formatFullName('Juan', '', 'Dela Cruz')).toBe('Juan Dela Cruz');
    expect(formatYearLevel(1)).toBe('1st Year');
    expect(formatYearLevel(4)).toBe('4th Year');
  });
});
