/**
 * Formats an array of byte values (numbers 0-255) into a colon-separated uppercase Hex string.
 * Example: [4, 167, 50, 145] -> "04:A7:32:91"
 */
export function bytesToHex(bytes?: number[] | Uint8Array | null, separator = ':'): string {
  if (!bytes || bytes.length === 0) return '';
  const hexParts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 0xff;
    hexParts.push(b.toString(16).padStart(2, '0').toUpperCase());
  }
  return hexParts.join(separator);
}

/**
 * Normalizes raw tag ID into human-readable colon format and compact format.
 */
export function formatTagId(id?: number[] | string | null): { formatted: string; compact: string; raw: number[] | null } {
  if (!id) {
    return { formatted: 'Unavailable', compact: 'N/A', raw: null };
  }

  if (Array.isArray(id)) {
    if (id.length === 0) {
      return { formatted: 'Unavailable', compact: 'N/A', raw: [] };
    }
    const formatted = bytesToHex(id, ':');
    const compact = bytesToHex(id, '');
    return { formatted, compact, raw: id };
  }

  if (typeof id === 'string') {
    const cleaned = id.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    if (cleaned.length === 0) {
      return { formatted: 'Unavailable', compact: 'N/A', raw: null };
    }
    const chunks: string[] = [];
    for (let i = 0; i < cleaned.length; i += 2) {
      chunks.push(cleaned.slice(i, i + 2));
    }
    const rawBytes = chunks.map(chunk => parseInt(chunk, 16));
    return {
      formatted: chunks.join(':'),
      compact: cleaned,
      raw: rawBytes
    };
  }

  return { formatted: 'Unavailable', compact: 'N/A', raw: null };
}

/**
 * Safely decodes a byte array into a UTF-8 string without throwing errors.
 */
export function bytesToUtf8(bytes?: number[] | Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return null;
  try {
    const uint8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const text = decoder.decode(uint8);
    // Filter out unprintable control characters except standard newlines/tabs
    const isPrintable = /^[\x20-\x7E\r\n\t\u00A0-\uFFFF]*$/.test(text);
    return isPrintable ? text : null;
  } catch {
    return null;
  }
}

/**
 * Formats byte size into readable string (e.g., "716 bytes", "1.2 KB").
 */
export function formatByteSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined || isNaN(bytes)) return 'Unknown';
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Formats a timestamp into human time (e.g. "9:43:12 PM").
 */
export function formatTime(timestamp: number | string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : (typeof timestamp === 'number' ? new Date(timestamp) : timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Formats a timestamp into date & time (e.g. "Today, 9:43 PM" or "Sep 15, 2026, 9:43 PM").
 */
export function formatDateTime(timestamp: number | string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : (typeof timestamp === 'number' ? new Date(timestamp) : timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `Today at ${timeStr}`;
  }
  if (isYesterday) {
    return `Yesterday at ${timeStr}`;
  }
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

/**
 * Safely serializes an object to JSON, handling BigInt, Circular references, and undefined.
 */
export function safeJsonStringify(obj: unknown, space = 2): string {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    },
    space
  );
}
