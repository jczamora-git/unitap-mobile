import { describe, it, expect, beforeEach } from 'vitest';
import { EventService } from '@/services/event.service';
import type { IEventRepository, EventDataStore } from '@/storage/event-storage.service';
import type { Event, EventOccurrence, OccurrenceParticipant } from '@/types/event';
import type { AttendanceScanLog } from '@/types/attendance';

class MockEventRepo implements IEventRepository {
  private data: EventDataStore = {
    events: [],
    occurrences: [],
    participants: [],
    scanLogs: []
  };

  async getData(): Promise<EventDataStore> { return this.data; }
  async getEvents(): Promise<Event[]> { return [...this.data.events]; }
  async getEventById(id: string): Promise<Event | null> { return this.data.events.find(e => e.id === id) || null; }
  async saveEvent(event: Event): Promise<Event> {
    const idx = this.data.events.findIndex(e => e.id === event.id);
    if (idx >= 0) this.data.events[idx] = event;
    else this.data.events.push(event);
    return event;
  }
  async deleteEvent(id: string): Promise<void> {
    this.data.events = this.data.events.filter(e => e.id !== id);
  }
  async getOccurrences(eventId?: string): Promise<EventOccurrence[]> {
    if (eventId) return this.data.occurrences.filter(o => o.eventId === eventId);
    return [...this.data.occurrences];
  }
  async getOccurrenceById(id: string): Promise<EventOccurrence | null> {
    return this.data.occurrences.find(o => o.id === id) || null;
  }
  async saveOccurrence(occurrence: EventOccurrence): Promise<EventOccurrence> {
    const idx = this.data.occurrences.findIndex(o => o.id === occurrence.id);
    if (idx >= 0) this.data.occurrences[idx] = occurrence;
    else this.data.occurrences.push(occurrence);
    return occurrence;
  }
  async getParticipants(occurrenceId?: string): Promise<OccurrenceParticipant[]> {
    if (occurrenceId) return this.data.participants.filter(p => p.occurrenceId === occurrenceId);
    return [...this.data.participants];
  }
  async saveParticipant(participant: OccurrenceParticipant): Promise<OccurrenceParticipant> {
    const idx = this.data.participants.findIndex(p => p.id === participant.id);
    if (idx >= 0) this.data.participants[idx] = participant;
    else this.data.participants.push(participant);
    return participant;
  }
  async saveParticipants(participants: OccurrenceParticipant[]): Promise<void> {
    participants.forEach(p => {
      const idx = this.data.participants.findIndex(item => item.id === p.id);
      if (idx >= 0) this.data.participants[idx] = p;
      else this.data.participants.push(p);
    });
  }
  async getScanLogs(occurrenceId?: string): Promise<AttendanceScanLog[]> {
    if (occurrenceId) return this.data.scanLogs.filter(l => l.occurrenceId === occurrenceId);
    return [...this.data.scanLogs];
  }
  async addScanLog(log: AttendanceScanLog): Promise<AttendanceScanLog> {
    this.data.scanLogs.push(log);
    return log;
  }
  clearCache(): void {}
  async resetAll(): Promise<void> {
    this.data = { events: [], occurrences: [], participants: [], scanLogs: [] };
  }
}

describe('EventService', () => {
  let repo: MockEventRepo;
  let service: EventService;

  beforeEach(() => {
    repo = new MockEventRepo();
    service = new EventService(repo);
  });

  it('creates an event with audience configuration', async () => {
    const event = await service.createEvent({
      title: 'IT Days 2026',
      description: 'Annual College Celebration',
      type: 'IT Day',
      audience: { type: 'ALL_BSIT' }
    });

    expect(event.id).toBeDefined();
    expect(event.title).toBe('IT Days 2026');
    expect(event.status).toBe('ACTIVE');
  });

  it('creates an occurrence session for an event', async () => {
    const event = await service.createEvent({
      title: 'IT Days 2026',
      description: 'Annual College Celebration',
      type: 'IT Day',
      audience: { type: 'ALL_BSIT' }
    });

    const occ = await service.createOccurrence({
      eventId: event.id,
      title: 'Morning Keynote',
      date: '2026-10-20',
      startTime: '08:00',
      endTime: '12:00',
      gracePeriodMinutes: 15
    });

    expect(occ.id).toBeDefined();
    expect(occ.status).toBe('SCHEDULED');
    expect(occ.gracePeriodMinutes).toBe(15);
  });

  it('converts pending participants to absent on occurrence closure', async () => {
    const event = await service.createEvent({
      title: 'Cleanup Drive',
      description: 'Civic Duty',
      type: 'Cleanup Drive',
      audience: { type: 'ALL_BSIT' }
    });

    const occ = await service.createOccurrence({
      eventId: event.id,
      title: 'Session 1',
      date: '2026-10-20',
      startTime: '07:00',
      endTime: '10:00'
    });

    // Seed mock participants: 1 Present, 1 Pending
    const p1: OccurrenceParticipant = {
      id: 'p1',
      occurrenceId: occ.id,
      eventId: event.id,
      studentId: 's1',
      attendanceStatus: 'PRESENT',
      updatedAt: new Date().toISOString()
    };
    const p2: OccurrenceParticipant = {
      id: 'p2',
      occurrenceId: occ.id,
      eventId: event.id,
      studentId: 's2',
      attendanceStatus: 'PENDING',
      updatedAt: new Date().toISOString()
    };
    await repo.saveParticipants([p1, p2]);

    // Close occurrence
    await service.closeOccurrence(occ.id);

    const closedParts = await repo.getParticipants(occ.id);
    const updatedP1 = closedParts.find(p => p.id === 'p1');
    const updatedP2 = closedParts.find(p => p.id === 'p2');

    expect(updatedP1?.attendanceStatus).toBe('PRESENT');
    expect(updatedP2?.attendanceStatus).toBe('ABSENT');
  });
});
