import { Preferences } from '@capacitor/preferences';
import type { Event, EventOccurrence, OccurrenceParticipant } from '@/types/event';
import type { AttendanceScanLog } from '@/types/attendance';

const EVENTS_STORAGE_KEY = 'unitap_events_v1';

export interface EventDataStore {
  events: Event[];
  occurrences: EventOccurrence[];
  participants: OccurrenceParticipant[];
  scanLogs: AttendanceScanLog[];
}

export interface IEventRepository {
  getData(): Promise<EventDataStore>;
  getEvents(): Promise<Event[]>;
  getEventById(id: string): Promise<Event | null>;
  saveEvent(event: Event): Promise<Event>;
  deleteEvent(id: string): Promise<void>;

  getOccurrences(eventId?: string): Promise<EventOccurrence[]>;
  getOccurrenceById(id: string): Promise<EventOccurrence | null>;
  saveOccurrence(occurrence: EventOccurrence): Promise<EventOccurrence>;
  deleteOccurrence(id: string): Promise<void>;

  getParticipants(occurrenceId?: string): Promise<OccurrenceParticipant[]>;
  saveParticipant(participant: OccurrenceParticipant): Promise<OccurrenceParticipant>;
  saveParticipants(participants: OccurrenceParticipant[]): Promise<void>;

  getScanLogs(occurrenceId?: string): Promise<AttendanceScanLog[]>;
  addScanLog(log: AttendanceScanLog): Promise<AttendanceScanLog>;

  clearCache(): void;
  resetAll(): Promise<void>;
}

export class LocalEventRepository implements IEventRepository {
  private cache: EventDataStore | null = null;

  clearCache(): void {
    this.cache = null;
  }

  async getData(): Promise<EventDataStore> {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      const { value } = await Preferences.get({ key: EVENTS_STORAGE_KEY });
      let data: EventDataStore = {
        events: [],
        occurrences: [],
        participants: [],
        scanLogs: []
      };

      if (value) {
        const parsed = JSON.parse(value);
        data = {
          events: Array.isArray(parsed.events) ? parsed.events : [],
          occurrences: Array.isArray(parsed.occurrences) ? parsed.occurrences : [],
          participants: Array.isArray(parsed.participants) ? parsed.participants : [],
          scanLogs: Array.isArray(parsed.scanLogs) ? parsed.scanLogs : []
        };
      } else {
        const local = typeof localStorage !== 'undefined' ? localStorage.getItem(EVENTS_STORAGE_KEY) : null;
        if (local) {
          const parsed = JSON.parse(local);
          data = {
            events: Array.isArray(parsed.events) ? parsed.events : [],
            occurrences: Array.isArray(parsed.occurrences) ? parsed.occurrences : [],
            participants: Array.isArray(parsed.participants) ? parsed.participants : [],
            scanLogs: Array.isArray(parsed.scanLogs) ? parsed.scanLogs : []
          };
        }
      }

      this.cache = data;
      return this.cache;
    } catch (err) {
      console.error('Error loading events storage:', err);
      this.cache = { events: [], occurrences: [], participants: [], scanLogs: [] };
      return this.cache;
    }
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    const jsonStr = JSON.stringify(this.cache);
    try {
      await Preferences.set({ key: EVENTS_STORAGE_KEY, value: jsonStr });
    } catch (err) {
      console.error('Failed to persist events store:', err);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(EVENTS_STORAGE_KEY, jsonStr);
        }
      } catch {
        // ignore
      }
    }
  }

  async getEvents(): Promise<Event[]> {
    const data = await this.getData();
    return [...data.events];
  }

  async getEventById(id: string): Promise<Event | null> {
    const events = await this.getEvents();
    return events.find(e => e.id === id) || null;
  }

  async saveEvent(event: Event): Promise<Event> {
    const data = await this.getData();
    const idx = data.events.findIndex(e => e.id === event.id);
    if (idx >= 0) {
      data.events[idx] = { ...event, updatedAt: new Date().toISOString() };
    } else {
      data.events.unshift(event);
    }
    await this.persist();
    return event;
  }

  async deleteEvent(id: string): Promise<void> {
    const data = await this.getData();
    data.events = data.events.filter(e => e.id !== id);
    data.occurrences = data.occurrences.filter(o => o.eventId !== id);
    data.participants = data.participants.filter(p => p.eventId !== id);
    await this.persist();
  }

  async getOccurrences(eventId?: string): Promise<EventOccurrence[]> {
    const data = await this.getData();
    if (eventId) {
      return data.occurrences.filter(o => o.eventId === eventId);
    }
    return [...data.occurrences];
  }

  async getOccurrenceById(id: string): Promise<EventOccurrence | null> {
    const occurrences = await this.getOccurrences();
    return occurrences.find(o => o.id === id) || null;
  }

  async saveOccurrence(occurrence: EventOccurrence): Promise<EventOccurrence> {
    const data = await this.getData();
    const idx = data.occurrences.findIndex(o => o.id === occurrence.id);
    if (idx >= 0) {
      data.occurrences[idx] = occurrence;
    } else {
      data.occurrences.unshift(occurrence);
    }
    await this.persist();
    return occurrence;
  }

  async deleteOccurrence(id: string): Promise<void> {
    const data = await this.getData();
    data.occurrences = data.occurrences.filter(o => o.id !== id);
    data.participants = data.participants.filter(p => p.occurrenceId !== id);
    data.scanLogs = data.scanLogs.filter(l => l.occurrenceId !== id);
    await this.persist();
  }

  async getParticipants(occurrenceId?: string): Promise<OccurrenceParticipant[]> {
    const data = await this.getData();
    if (occurrenceId) {
      return data.participants.filter(p => p.occurrenceId === occurrenceId);
    }
    return [...data.participants];
  }

  async saveParticipant(participant: OccurrenceParticipant): Promise<OccurrenceParticipant> {
    const data = await this.getData();
    const idx = data.participants.findIndex(p => p.id === participant.id);
    if (idx >= 0) {
      data.participants[idx] = { ...participant, updatedAt: new Date().toISOString() };
    } else {
      data.participants.push(participant);
    }
    await this.persist();
    return participant;
  }

  async saveParticipants(participants: OccurrenceParticipant[]): Promise<void> {
    const data = await this.getData();
    participants.forEach(p => {
      const idx = data.participants.findIndex(item => item.id === p.id);
      if (idx >= 0) {
        data.participants[idx] = { ...p, updatedAt: new Date().toISOString() };
      } else {
        data.participants.push(p);
      }
    });
    await this.persist();
  }

  async getScanLogs(occurrenceId?: string): Promise<AttendanceScanLog[]> {
    const data = await this.getData();
    if (occurrenceId) {
      return data.scanLogs.filter(l => l.occurrenceId === occurrenceId);
    }
    return [...data.scanLogs];
  }

  async addScanLog(log: AttendanceScanLog): Promise<AttendanceScanLog> {
    const data = await this.getData();
    data.scanLogs.unshift(log);
    // Keep max 200 scan logs to avoid bloating
    if (data.scanLogs.length > 200) {
      data.scanLogs = data.scanLogs.slice(0, 200);
    }
    await this.persist();
    return log;
  }

  async resetAll(): Promise<void> {
    this.cache = {
      events: [],
      occurrences: [],
      participants: [],
      scanLogs: []
    };
    await this.persist();
  }
}

export const localEventRepository = new LocalEventRepository();
