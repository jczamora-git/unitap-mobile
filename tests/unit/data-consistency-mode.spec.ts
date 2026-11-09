import { describe, it, expect, beforeEach } from 'vitest';
import { DataModeService } from '@/services/data-mode.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { SchemaMapperService } from '@/services/sync/schema-mapper.service';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { SyncManager } from '@/services/sync/sync-manager';

describe('UniTap 2.0 Android/Web Data Consistency & Synchronization Diagnostics', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
  });

  describe('1. DataModeService & Environment Diagnostics', () => {
    it('allows toggling between Direct Supabase Mode and Offline-First SQLite Mode', () => {
      DataModeService.setMode('supabase_direct');
      expect(DataModeService.isDirectSupabase()).toBe(true);
      expect(DataModeService.isOfflineFirst()).toBe(false);
      expect(DataModeService.getModeLabel()).toBe('Direct Supabase Mode');

      DataModeService.setMode('offline_first');
      expect(DataModeService.isDirectSupabase()).toBe(false);
      expect(DataModeService.isOfflineFirst()).toBe(true);
      expect(DataModeService.getModeLabel()).toBe('Offline-First SQLite Mode');
    });

    it('returns valid environment info with version and endpoint metadata', () => {
      const info = DataModeService.getEnvironmentInfo();
      expect(info.versionName).toBe('1.0.1');
      expect(info.versionCode).toBe(2);
      expect(info.supabaseUrl).toContain('supabase.co');
    });
  });

  describe('2. Accurate Pending Pulls Calculation (Fixes 5 Pending Pulls on 0-record tables)', () => {
    it('does not treat successfully synced 0-record entities as pending pulls', async () => {
      const db = await getDatabase();

      // Mark all registered entities in entity_sync_checkpoints as SUCCESS
      // Even if records_pulled = 0 (such as empty server tables)
      await db.execute(`
        UPDATE entity_sync_checkpoints 
        SET last_pulled_at = '2026-11-10T01:00:00.000Z', 
            records_pulled = 0, 
            last_sync_status = 'SUCCESS'
      `);

      await SyncManager.refreshCountsFromDatabase();
      // All succeeded and advanced past epoch. Pending pull count should be 0.
      expect(SyncStatusService.pendingPullCount.value).toBe(0);
    });

    it('correctly detects entities that failed or have never been pulled', async () => {
      const db = await getDatabase();

      // Set all to SUCCESS first
      await db.execute(`
        UPDATE entity_sync_checkpoints 
        SET last_pulled_at = '2026-11-10T01:00:00.000Z', 
            records_pulled = 10, 
            last_sync_status = 'SUCCESS'
      `);

      // Now set exactly 2 entities to pending/failed: 1 IDLE at epoch, 1 FAILED
      await db.execute(`
        UPDATE entity_sync_checkpoints
        SET last_pulled_at = '1970-01-01T00:00:00.000Z',
            last_sync_status = 'IDLE'
        WHERE entity_name = 'events'
      `);
      await db.execute(`
        UPDATE entity_sync_checkpoints
        SET last_sync_status = 'FAILED'
        WHERE entity_name = 'students'
      `);

      await SyncManager.refreshCountsFromDatabase();
      expect(SyncStatusService.pendingPullCount.value).toBe(2);
    });
  });

  describe('3. Accurate Status Indicators (Eliminates False "Up to Date")', () => {
    it('displays Sync Incomplete when pending pulls remain instead of false Up to Date', () => {
      DataModeService.setMode('offline_first');
      SyncStatusService.setState('UP_TO_DATE');
      SyncStatusService.setOnline(true);
      SyncStatusService.setPendingPullCount(5);
      SyncStatusService.setPendingCount(0);
      SyncStatusService.setFailedOpsCount(0);

      expect(SyncStatusService.userFacingStatus.value).toBe('Sync Incomplete');
    });

    it('displays Up to Date when all pulls and pushes are complete in Offline-First mode', () => {
      DataModeService.setMode('offline_first');
      SyncStatusService.setState('UP_TO_DATE');
      SyncStatusService.setOnline(true);
      SyncStatusService.setPendingPullCount(0);
      SyncStatusService.setPendingCount(0);
      SyncStatusService.setFailedOpsCount(0);

      expect(SyncStatusService.userFacingStatus.value).toBe('Up to Date');
    });

    it('displays Direct Supabase Mode when in direct mode', () => {
      DataModeService.setMode('supabase_direct');
      expect(SyncStatusService.userFacingStatus.value).toBe('Direct Supabase Mode');
    });
  });

  describe('4. SchemaMapperService Resilient Event Ingestion', () => {
    it('maps event_occurrences checkpoints_json safely', () => {
      const raw = {
        id: 'occ_test_1',
        event_id: 'ev_test_1',
        title: 'Morning Session',
        occurs_on: '2026-11-10',
        starts_at: '08:00',
        ends_at: '12:00',
        status: 'SCHEDULED',
        checkpoints: [
          { id: 'cp_1', label: 'Morning IN', type: 'IN', opensAt: '07:00', closesAt: '08:30' },
        ],
      };

      const mapped = SchemaMapperService.mapRecord('event_occurrences', raw);
      expect(mapped.checkpoints_json).toContain('Morning IN');
      expect(mapped.starts_at).toBe('08:00');
      expect(mapped.ends_at).toBe('12:00');
    });

    it('safely upserts events into SQLite even if foreign keys are not yet locally provisioned', async () => {
      const db = await getDatabase();
      const validTableInfo = await db.query<{ name: string }>('PRAGMA table_info(events)');
      const validColumns = new Set<string>((validTableInfo || []).map(c => c.name));

      const eventRecord = {
        id: 'ev_remote_unmapped_fk',
        semester_id: 'sem_remote_uuid_9999',
        category_id: 'cat_unknown_uuid_8888',
        created_by_user_id: 'usr_unknown_uuid_7777',
        title: 'Campus IT Assembly 2026',
        description: 'Annual gathering',
        event_type: 'SEMINAR',
        audience_type: 'ALL',
        audience_json: '{}',
        attendance_required: 1,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // safeUpsertRecord should gracefully resolve semester and nullify missing optional foreign keys
      const applied = await SchemaMapperService.safeUpsertRecord(db, 'events', eventRecord, validColumns);
      expect(applied).toBe(true);

      const inserted = await db.queryOne<{ id: string; title: string }>('SELECT id, title FROM events WHERE id = ?', ['ev_remote_unmapped_fk']);
      expect(inserted?.title).toBe('Campus IT Assembly 2026');
    });

    it('sanitizes event_occurrences starts_at < ends_at constraint to prevent check failure', async () => {
      const db = await getDatabase();
      const validTableInfo = await db.query<{ name: string }>('PRAGMA table_info(event_occurrences)');
      const validColumns = new Set<string>((validTableInfo || []).map(c => c.name));

      // Make sure parent event exists using safeUpsertRecord
      const eventColumns = new Set<string>((await db.query<{ name: string }>('PRAGMA table_info(events)') || []).map(c => c.name));
      await SchemaMapperService.safeUpsertRecord(db, 'events', {
        id: 'ev_parent_occ_test',
        semester_id: 'sem_test',
        title: 'Parent Event',
        event_type: 'IT_DAY',
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, eventColumns);

      const occurrenceRecord = {
        id: 'occ_check_constraint_test',
        event_id: 'ev_parent_occ_test',
        title: 'Malformed Time Window Session',
        occurs_on: '2026-11-10',
        starts_at: '17:00',
        ends_at: '08:00', // Malformed: ends_at <= starts_at
        grace_minutes: 15,
        status: 'SCHEDULED',
        checkpoints_json: '[]',
        updated_at: new Date().toISOString(),
      };

      const applied = await SchemaMapperService.safeUpsertRecord(db, 'event_occurrences', occurrenceRecord, validColumns);
      expect(applied).toBe(true);

      const inserted = await db.queryOne<{ id: string; starts_at: string; ends_at: string }>('SELECT id, starts_at, ends_at FROM event_occurrences WHERE id = ?', ['occ_check_constraint_test']);
      expect(inserted?.starts_at < inserted?.ends_at!).toBe(true);
    });
  });
});

