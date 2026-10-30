import type { NormalizedNfcTag } from '@/types/nfc';
import type { NfcTag } from '@capgo/capacitor-nfc';
import { formatDateTime, formatTagId } from './nfc-formatters';
import { resolveTechnologies, inferTagType } from './tag-technology';
import { decodeNdefMessage } from './ndef-decoder';

/**
 * Transforms raw native NfcTag payload into clean NormalizedNfcTag data structure.
 */
export function normalizeNfcTag(rawTag: NfcTag): NormalizedNfcTag {
  const now = Date.now();
  const idInfo = formatTagId(rawTag.id);
  const technologies = resolveTechnologies(rawTag.techTypes);
  const ndefRecords = decodeNdefMessage(rawTag.ndefMessage);
  const hasNdef = ndefRecords.length > 0;
  const inferredType = inferTagType(rawTag);

  return {
    id: idInfo.formatted,
    compactId: idInfo.compact,
    rawId: idInfo.raw,
    timestamp: now,
    formattedTimestamp: formatDateTime(now),
    type: inferredType,
    technologies,
    ndefRecords,
    hasNdef,
    isWritable: typeof rawTag.isWritable === 'boolean' ? rawTag.isWritable : null,
    maxSize: typeof rawTag.maxSize === 'number' ? rawTag.maxSize : null,
    canMakeReadOnly: typeof rawTag.canMakeReadOnly === 'boolean' ? rawTag.canMakeReadOnly : null,
    raw: rawTag
  };
}
