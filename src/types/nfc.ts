import type { NdefRecord, NfcTag } from '@capgo/capacitor-nfc';

export interface TechInfo {
  name: string;
  rawName: string;
  standard: string;
  description: string;
}

export interface DecodedNdefRecord {
  index: number;
  tnf: number;
  tnfLabel: string;
  type: string;
  id: string;
  payload: string;
  payloadHex: string;
  payloadUtf8: string | null;
  mediaType?: string;
  uri?: string;
  encoding?: string;
  language?: string;
  rawRecord: NdefRecord;
}

export interface NormalizedNfcTag {
  id: string;               // e.g. "04:A7:32:91:BC:20:80" or "Unavailable"
  compactId: string;        // e.g. "04A73291BC2080" or "N/A"
  rawId: number[] | null;
  timestamp: number;
  formattedTimestamp: string;
  type: string;             // Friendly classification e.g. "MIFARE Classic compatible"
  technologies: TechInfo[];
  ndefRecords: DecodedNdefRecord[];
  hasNdef: boolean;
  isWritable: boolean | null;
  maxSize: number | null;
  canMakeReadOnly: boolean | null;
  raw: NfcTag;
}

export interface ScanHistoryItem {
  id: string;
  scannedAt: string;
  tag: NormalizedNfcTag;
}

export type NfcPlatform = 'android' | 'ios' | 'web';

export interface NfcDeviceStatus {
  supported: boolean;
  enabled: boolean;
  status: 'NFC_OK' | 'NO_NFC' | 'NFC_DISABLED' | 'NDEF_PUSH_DISABLED' | 'UNSUPPORTED' | 'WEB_UNAVAILABLE' | 'UNKNOWN';
  pluginVersion: string | null;
  platform: NfcPlatform;
  error: string | null;
}

export type ScannerState = 'idle' | 'scanning' | 'detected' | 'error' | 'unsupported' | 'disabled';

export interface UidStabilityScanResult {
  scanNumber: number;
  rawId: string;
  formattedId: string;
  timestamp: number;
}

export type UidStabilityVerdict = 'stable' | 'dynamic' | 'undetermined' | null;
