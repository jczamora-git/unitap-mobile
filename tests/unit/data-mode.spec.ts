import { describe, it, expect, beforeEach } from 'vitest';
import { DataModeService } from '@/services/data-mode.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';

describe('UniTap 2.0 Direct Supabase Development Mode', () => {
  beforeEach(() => {
    DataModeService.setMode('offline_first');
  });

  it('defaults to offline_first in the test environment', () => {
    expect(DataModeService.isOfflineFirst()).toBe(true);
    expect(DataModeService.isDirectSupabase()).toBe(false);
    expect(DataModeService.getModeLabel()).toBe('Offline-First SQLite Mode');
  });

  it('transitions cleanly to supabase_direct when configured', () => {
    DataModeService.setMode('supabase_direct');
    expect(DataModeService.isDirectSupabase()).toBe(true);
    expect(DataModeService.isOfflineFirst()).toBe(false);
    expect(DataModeService.getModeLabel()).toBe('Direct Supabase Mode');
    expect(DataModeService.mode.value).toBe('supabase_direct');
  });

  it('reflects DIRECT_MODE in SyncStatusService when direct mode is active', () => {
    DataModeService.setMode('supabase_direct');
    expect(SyncStatusService.canonicalState.value).toBe('DIRECT_MODE');
    expect(SyncStatusService.userFacingStatus.value).toBe('Direct Supabase Mode');

    DataModeService.setMode('offline_first');
    expect(SyncStatusService.canonicalState.value).not.toBe('DIRECT_MODE');
  });

  it('allows switching back to offline_first seamlessly', () => {
    DataModeService.setMode('supabase_direct');
    expect(DataModeService.isDirectSupabase()).toBe(true);

    DataModeService.setMode('offline_first');
    expect(DataModeService.isDirectSupabase()).toBe(false);
    expect(DataModeService.isOfflineFirst()).toBe(true);
  });
});

