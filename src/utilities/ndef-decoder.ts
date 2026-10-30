import type { DecodedNdefRecord } from '@/types/nfc';
import type { NdefRecord } from '@capgo/capacitor-nfc';
import { bytesToHex, bytesToUtf8 } from './nfc-formatters';

const TNF_LABELS: Record<number, string> = {
  0x00: 'Empty (TNF 0)',
  0x01: 'NFC Forum Well Known (TNF 1)',
  0x02: 'MIME Media Type (TNF 2)',
  0x03: 'Absolute URI (TNF 3)',
  0x04: 'NFC Forum External (TNF 4)',
  0x05: 'Unknown (TNF 5)',
  0x06: 'Unchanged (TNF 6)',
  0x07: 'Reserved (TNF 7)'
};

const URI_PREFIX_MAP: Record<number, string> = {
  0x00: '',
  0x01: 'http://www.',
  0x02: 'https://www.',
  0x03: 'http://',
  0x04: 'https://',
  0x05: 'tel:',
  0x06: 'mailto:',
  0x07: 'ftp://anonymous:anonymous@',
  0x08: 'ftp://ftp.',
  0x09: 'ftps://',
  0x0a: 'sftp://',
  0x0b: 'smb://',
  0x0c: 'nfs://',
  0x0d: 'ftp://',
  0x0e: 'dav://',
  0x0f: 'news:',
  0x10: 'telnet://',
  0x11: 'imap:',
  0x12: 'rtsp://',
  0x13: 'urn:',
  0x14: 'pop:',
  0x15: 'sip:',
  0x16: 'sips:',
  0x17: 'tftp:',
  0x18: 'btspp://',
  0x19: 'btl2cap://',
  0x1a: 'btgoep://',
  0x1b: 'tcpobex://',
  0x1c: 'irdaobex://',
  0x1d: 'file://',
  0x1e: 'urn:epc:id:',
  0x1f: 'urn:epc:tag:',
  0x20: 'urn:epc:pat:',
  0x21: 'urn:epc:raw:',
  0x22: 'urn:epc:',
  0x23: 'urn:nfc:'
};

/**
 * Decodes RTD Text Record (RFC NFC Forum RTD 1.0)
 */
function decodeTextRecord(payload: number[]): { text: string; language: string; encoding: string } | null {
  if (!payload || payload.length === 0) return null;

  try {
    const statusByte = payload[0];
    const isUtf16 = (statusByte & 0x80) !== 0;
    const encoding = isUtf16 ? 'UTF-16' : 'UTF-8';
    const langCodeLength = statusByte & 0x3f;

    if (payload.length < 1 + langCodeLength) return null;

    const langBytes = payload.slice(1, 1 + langCodeLength);
    const textBytes = payload.slice(1 + langCodeLength);

    const language = String.fromCharCode(...langBytes);
    let text = '';

    if (isUtf16) {
      const u16Array = new Uint16Array(
        new Uint8Array(textBytes).buffer
      );
      text = String.fromCharCode(...u16Array);
    } else {
      const decoded = bytesToUtf8(textBytes);
      text = decoded !== null ? decoded : String.fromCharCode(...textBytes);
    }

    return { text, language, encoding };
  } catch {
    return null;
  }
}

/**
 * Decodes RTD URI Record
 */
function decodeUriRecord(payload: number[]): { uri: string } | null {
  if (!payload || payload.length === 0) return null;

  try {
    const prefixCode = payload[0];
    const prefix = URI_PREFIX_MAP[prefixCode] ?? '';
    const restBytes = payload.slice(1);
    const restText = bytesToUtf8(restBytes) || String.fromCharCode(...restBytes);
    return { uri: `${prefix}${restText}` };
  } catch {
    return null;
  }
}

/**
 * Decodes an individual NdefRecord into a clean user-presentable DecodedNdefRecord.
 */
export function decodeNdefRecord(record: NdefRecord, index: number): DecodedNdefRecord {
  const tnf = record.tnf ?? 0;
  const tnfLabel = TNF_LABELS[tnf] || `Unknown TNF (${tnf})`;

  const typeBytes = record.type || [];
  const typeStr = bytesToUtf8(typeBytes) || bytesToHex(typeBytes);

  const idBytes = record.id || [];
  const idStr = idBytes.length > 0 ? (bytesToUtf8(idBytes) || bytesToHex(idBytes)) : '';

  const payload = record.payload || [];
  const payloadHex = bytesToHex(payload, ' ');
  const payloadUtf8 = bytesToUtf8(payload);

  let displayPayload = payloadUtf8 || `[Binary Data: ${payload.length} bytes]`;
  let mediaType: string | undefined = undefined;
  let uri: string | undefined = undefined;
  let encoding: string | undefined = undefined;
  let language: string | undefined = undefined;

  // Well-Known Record Types
  if (tnf === 0x01) {
    // Check if RTD_TEXT ("T" = 0x54)
    if (typeBytes.length === 1 && typeBytes[0] === 0x54) {
      const textResult = decodeTextRecord(payload);
      if (textResult) {
        displayPayload = textResult.text;
        encoding = textResult.encoding;
        language = textResult.language;
      }
    }
    // Check if RTD_URI ("U" = 0x55)
    else if (typeBytes.length === 1 && typeBytes[0] === 0x55) {
      const uriResult = decodeUriRecord(payload);
      if (uriResult) {
        displayPayload = uriResult.uri;
        uri = uriResult.uri;
      }
    }
    // Smart Poster ("Sp" = 0x53, 0x70)
    else if (typeBytes.length === 2 && typeBytes[0] === 0x53 && typeBytes[1] === 0x70) {
      displayPayload = `Smart Poster (${payload.length} bytes)`;
    }
  }
  // MIME Media Types
  else if (tnf === 0x02) {
    mediaType = typeStr;
    displayPayload = payloadUtf8 || `[MIME Payload: ${payload.length} bytes]`;
  }
  // Absolute URI
  else if (tnf === 0x03) {
    uri = typeStr;
    displayPayload = payloadUtf8 || typeStr;
  }
  // External Type
  else if (tnf === 0x04) {
    displayPayload = `External Type [${typeStr}]: ${payloadUtf8 || payloadHex}`;
  }

  return {
    index,
    tnf,
    tnfLabel,
    type: typeStr || 'None',
    id: idStr || 'None',
    payload: displayPayload,
    payloadHex,
    payloadUtf8,
    mediaType,
    uri,
    encoding,
    language,
    rawRecord: record
  };
}

/**
 * Decodes an array of raw NdefRecord objects into DecodedNdefRecord list.
 */
export function decodeNdefMessage(ndefMessage?: NdefRecord[] | null): DecodedNdefRecord[] {
  if (!ndefMessage || !Array.isArray(ndefMessage) || ndefMessage.length === 0) {
    return [];
  }

  return ndefMessage.map((rec, idx) => decodeNdefRecord(rec, idx));
}
