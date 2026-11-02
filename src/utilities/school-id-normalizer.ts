/**
 * Canonical School ID Normalizer for UniTap.
 * 
 * Rules:
 * 1. Trims leading and trailing whitespace.
 * 2. Formats known institutional prefix (MCC):
 *    - Recognizes any MCC variant: 'MCC-2026-0256', 'MCC2026-0256', 'mcc-2026-0256', 'MCC 2026 0256', 'MCC_2026_0256'
 *    - Resolves canonically to 'MCC<YEAR>-<SEQUENCE>' e.g. 'MCC2026-0256'
 *    - Preserves all digits, leading zeroes, and uppercase characters.
 * 3. General format preservation:
 *    - Does NOT mutate unrelated institutions or collapse arbitrary numbers.
 *    - Preserves casing and numeric sequences.
 */

/**
 * Normalizes a raw School ID into its canonical representation.
 */
export function normalizeSchoolId(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // MCC Institution Pattern: MCC [-/_/space]* YYYY [-/_/space]* SEQUENCE
  // Example: MCC-2026-0256, MCC2026-0256, mcc 2026 0256 -> MCC2026-0256
  const mccMatch = trimmed.match(/^MCC[\s\-_]*(\d{4})[\s\-_]*(\d{3,6})$/i);
  if (mccMatch) {
    const year = mccMatch[1];
    const seq = mccMatch[2];
    return `MCC${year}-${seq}`;
  }

  // Non-MCC alphanumeric pattern: preserve characters and uppercase
  return trimmed.toUpperCase();
}

/**
 * Checks whether two School ID strings resolve to the exact same canonical identity.
 */
export function areSchoolIdsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  const normA = normalizeSchoolId(a);
  const normB = normalizeSchoolId(b);
  return normA.length > 0 && normA === normB;
}

/**
 * Returns all acceptable database search variants for a given School ID.
 * This is used for backward-compatible SQLite queries where historical records
 * might exist with hyphens (e.g. 'MCC-2026-0256') or without ('MCC2026-0256').
 */
export function getSchoolIdVariants(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const canonical = normalizeSchoolId(trimmed);
  const variants = new Set<string>();
  variants.add(trimmed);
  variants.add(canonical);

  // If MCC format, also generate the alternate hyphenated format 'MCC-YYYY-SEQ'
  const mccMatch = trimmed.match(/^MCC[\s\-_]*(\d{4})[\s\-_]*(\d{3,6})$/i);
  if (mccMatch) {
    const year = mccMatch[1];
    const seq = mccMatch[2];
    variants.add(`MCC${year}-${seq}`);     // MCC2026-0256 (canonical)
    variants.add(`MCC-${year}-${seq}`);    // MCC-2026-0256 (legacy hyphenated)
    variants.add(`MCC${year}${seq}`);      // MCC20260256 (compact)
  }

  return Array.from(variants);
}

