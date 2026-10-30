/**
 * Date and time formatting utilities for UniTap
 */

export function formatDate(isoOrDateStr?: string | null): string {
  if (!isoOrDateStr) return 'N/A';
  try {
    const d = new Date(isoOrDateStr);
    if (isNaN(d.getTime())) return isoOrDateStr;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return isoOrDateStr;
  }
}

export function formatTime(timeStr?: string | null): string {
  if (!timeStr) return '';
  // Check if it's already HH:mm
  if (/^\d{2}:\d{2}$/.test(timeStr)) {
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${m.toString().padStart(2, '0')} ${period}`;
  }
  try {
    const d = new Date(timeStr);
    if (isNaN(d.getTime())) return timeStr;
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return timeStr;
  }
}

export function formatDateTime(isoStr?: string | null): string {
  if (!isoStr) return 'N/A';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return isoStr;
  }
}

export function isPastTime(dateStr: string, timeStr: string, graceMinutes: number = 0): boolean {
  try {
    const [h, m] = timeStr.split(':').map(Number);
    const target = new Date(`${dateStr}T${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:00`);
    target.setMinutes(target.getMinutes() + graceMinutes);
    return Date.now() > target.getTime();
  } catch {
    return false;
  }
}
