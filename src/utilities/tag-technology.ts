import type { TechInfo } from '@/types/nfc';
import type { NfcTag } from '@capgo/capacitor-nfc';

interface TechMetadata {
  shortName: string;
  standard: string;
  description: string;
}

const TECH_CATALOG: Record<string, TechMetadata> = {
  NfcA: {
    shortName: 'NfcA',
    standard: 'ISO 14443-3A',
    description: 'ISO 14443 Type A radio frequency communication standard.'
  },
  NfcB: {
    shortName: 'NfcB',
    standard: 'ISO 14443-3B',
    description: 'ISO 14443 Type B radio frequency communication standard.'
  },
  NfcF: {
    shortName: 'NfcF',
    standard: 'JIS 6319-4 / FeliCa',
    description: 'Sony FeliCa communication standard, commonly used in transit & payment cards.'
  },
  NfcV: {
    shortName: 'NfcV',
    standard: 'ISO 15693 / Vicinity RFID',
    description: 'Vicinity RFID standard for long-range item tracking and smart labels.'
  },
  IsoDep: {
    shortName: 'IsoDep',
    standard: 'ISO 14443-4 (ISO-DEP)',
    description: 'High-level transmission protocol for contactless smart cards & secure elements.'
  },
  Ndef: {
    shortName: 'Ndef',
    standard: 'NFC Forum NDEF',
    description: 'Contains standard NFC Data Exchange Format formatted records.'
  },
  NdefFormatable: {
    shortName: 'NdefFormatable',
    standard: 'NFC Forum Formattable',
    description: 'Unformatted tag that supports being formatted with NDEF data.'
  },
  MifareClassic: {
    shortName: 'MifareClassic',
    standard: 'NXP MIFARE Classic',
    description: 'NXP proprietary 13.56 MHz RFID technology with memory sector structure.'
  },
  MifareUltralight: {
    shortName: 'MifareUltralight',
    standard: 'NXP MIFARE Ultralight / NTAG',
    description: 'NXP low-cost memory tag family including Ultralight C, EV1, and NTAG2xx series.'
  },
  NfcBarcode: {
    shortName: 'NfcBarcode',
    standard: 'Kovio / Thinfilm Barcode',
    description: 'Read-only RFID technology transmitting fixed-length identification payload.'
  }
};

/**
 * Normalizes tech strings into structured TechInfo objects with standard and description.
 */
export function resolveTechnologies(techTypes?: string[] | null): TechInfo[] {
  if (!techTypes || techTypes.length === 0) {
    return [];
  }

  return techTypes.map(rawTech => {
    // Extract simple name (e.g. "android.nfc.tech.NfcA" -> "NfcA")
    const parts = rawTech.split('.');
    const simpleName = parts[parts.length - 1];

    const catalogEntry = TECH_CATALOG[simpleName];

    if (catalogEntry) {
      return {
        name: catalogEntry.shortName,
        rawName: rawTech,
        standard: catalogEntry.standard,
        description: catalogEntry.description
      };
    }

    return {
      name: simpleName || rawTech,
      rawName: rawTech,
      standard: 'Proprietary / Custom',
      description: `Technology reported by native platform: ${rawTech}`
    };
  });
}

/**
 * Safely infers a user-friendly tag classification based on available metadata.
 * Does not make false claims about exact silicon if not provable.
 */
export function inferTagType(tag: NfcTag): string {
  // If plugin explicitly exposed a type string, use it as baseline
  if (tag.type && typeof tag.type === 'string' && tag.type.trim() !== '') {
    return tag.type.trim();
  }

  const rawTechs = (tag.techTypes || []).map(t => t.split('.').pop() || t);

  if (rawTechs.includes('MifareClassic')) {
    return 'MIFARE Classic compatible';
  }

  if (rawTechs.includes('MifareUltralight')) {
    return 'MIFARE Ultralight / NTAG compatible';
  }

  if (rawTechs.includes('IsoDep')) {
    if (rawTechs.includes('NfcA')) {
      return 'ISO-DEP (ISO 14443-4 Type A)';
    }
    if (rawTechs.includes('NfcB')) {
      return 'ISO-DEP (ISO 14443-4 Type B)';
    }
    return 'ISO-DEP compatible';
  }

  if (rawTechs.includes('Ndef')) {
    return 'NDEF Tag';
  }

  if (rawTechs.includes('NdefFormatable')) {
    return 'NDEF Formattable Tag';
  }

  if (rawTechs.includes('NfcA')) {
    return 'NFC-A (ISO 14443-3A) Tag';
  }

  if (rawTechs.includes('NfcB')) {
    return 'NFC-B (ISO 14443-3B) Tag';
  }

  if (rawTechs.includes('NfcF')) {
    return 'FeliCa (JIS 6319-4) Tag';
  }

  if (rawTechs.includes('NfcV')) {
    return 'Vicinity RFID (ISO 15693) Tag';
  }

  if (rawTechs.length > 0) {
    return `${rawTechs[0]} Tag`;
  }

  return 'Unknown NFC Tag';
}
