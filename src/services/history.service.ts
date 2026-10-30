import { Preferences } from '@capacitor/preferences';
import type { NormalizedNfcTag, ScanHistoryItem } from '@/types/nfc';

const STORAGE_KEY = 'nfc_inspector_history_v1';
const MAX_HISTORY_ITEMS = 100;

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'scan_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

class HistoryService {
  private cache: ScanHistoryItem[] | null = null;

  async getHistory(): Promise<ScanHistoryItem[]> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (!value) {
        this.cache = [];
        return [];
      }
      const parsed = JSON.parse(value);
      this.cache = Array.isArray(parsed) ? parsed : [];
      return this.cache;
    } catch (e) {
      console.error('Failed to load scan history from Preferences:', e);
      // Fallback to localStorage if available
      try {
        const local = localStorage.getItem(STORAGE_KEY);
        this.cache = local ? JSON.parse(local) : [];
        return this.cache || [];
      } catch {
        this.cache = [];
        return [];
      }
    }
  }

  async addScan(tag: NormalizedNfcTag): Promise<ScanHistoryItem> {
    const history = await this.getHistory();
    const item: ScanHistoryItem = {
      id: generateId(),
      scannedAt: new Date().toISOString(),
      tag
    };

    // Prepend (newest first) and trim to max items
    const updated = [item, ...history].slice(0, MAX_HISTORY_ITEMS);
    this.cache = updated;

    await this.persist(updated);
    return item;
  }

  async deleteScan(id: string): Promise<void> {
    const history = await this.getHistory();
    const filtered = history.filter(item => item.id !== id);
    this.cache = filtered;
    await this.persist(filtered);
  }

  async clearHistory(): Promise<void> {
    this.cache = [];
    await Preferences.remove({ key: STORAGE_KEY });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }

  private async persist(items: ScanHistoryItem[]): Promise<void> {
    const str = JSON.stringify(items);
    try {
      await Preferences.set({ key: STORAGE_KEY, value: str });
    } catch (e) {
      console.error('Failed to persist scan history:', e);
      try {
        localStorage.setItem(STORAGE_KEY, str);
      } catch {
        // Ignore
      }
    }
  }
}

export const historyService = new HistoryService();
