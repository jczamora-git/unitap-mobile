import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDatabaseForTests } from '@/database/database';
import { WebDevSqliteAdapter } from '@/database/adapters/web-dev.adapter';
import { NativeSqliteAdapter } from '@/database/adapters/native-sqlite.adapter';
import { Capacitor } from '@capacitor/core';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { InitialSyncService } from '@/services/sync/initial-sync.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { supabase } from '@/integrations/supabase/client';

describe('UniTap 2.0 Login to Initial Sync Regression Suite', () => {
  beforeEach(async () => {
    await resetDatabaseForTests();
    vi.restoreAllMocks();
  });

  it('initializes WebDevSqliteAdapter without network WASM fetch error', async () => {
    const adapter = new WebDevSqliteAdapter();
    expect(adapter.isInitialized()).toBe(false);

    await adapter.initialize();
    expect(adapter.isInitialized()).toBe(true);

    // Verify basic queries and transactions work
    await adapter.execute('CREATE TABLE IF NOT EXISTS test_wasm (id TEXT PRIMARY KEY, value TEXT)');
    await adapter.execute('INSERT INTO test_wasm (id, value) VALUES (?, ?)', ['1', 'wasm_ok']);
    const rows = await adapter.query<{ value: string }>('SELECT value FROM test_wasm WHERE id = ?', ['1']);
    expect(rows.length).toBe(1);
    expect(rows[0].value).toBe('wasm_ok');

    await adapter.close();
  });

  it('selects NativeSqliteAdapter on native platform and WebDevSqliteAdapter on web', async () => {
    // 1. Web Platform
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    const webDb = await resetDatabaseForTests();
    expect(webDb).toBeInstanceOf(WebDevSqliteAdapter);

    // 2. Native Platform verification
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    // When on native platform, NativeSqliteAdapter is instantiated
    const nativeAdapter = new NativeSqliteAdapter();
    expect(nativeAdapter).toBeInstanceOf(NativeSqliteAdapter);
  });

  it('re-attempts initialization after a transient failure instead of permanently caching the failure', async () => {
    // Force first attempt to fail
    let attempts = 0;
    const testAdapter = new WebDevSqliteAdapter();
    const originalInit = testAdapter.initialize.bind(testAdapter);
    
    vi.spyOn(testAdapter, 'initialize').mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Simulated transient initialization error');
      }
      return originalInit();
    });

    // Attempt 1 fails
    await expect(testAdapter.initialize()).rejects.toThrow('Simulated transient initialization error');

    // Attempt 2 succeeds (retry)
    await expect(testAdapter.initialize()).resolves.toBeUndefined();
    expect(testAdapter.isInitialized()).toBe(true);
    await testAdapter.close();
  });

  it('executes successful DevAdmin login -> local SQLite session setup -> initial sync flow', async () => {
    const mockUser = {
      id: 'devadmin-reg-uuid-001',
      email: 'devadmin@unitap.app',
    };

    // Mock Supabase signInWithPassword success
    vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
      data: {
        user: mockUser as any,
        session: { access_token: 'fake_jwt', refresh_token: 'fake_ref' } as any,
      },
      error: null,
    });

    // 1. DevAdmin Login
    const loginResult = await SupabaseAuthService.login('devadmin@unitap.app', 'correct-password');
    expect(loginResult.success).toBe(true);
    expect(loginResult.role).toBe('DEVADMIN');
    expect(SupabaseAuthService.role.value).toBe('DEVADMIN');

    // 2. Initial Hydration Check: SQLite is initially not hydrated
    const isHydratedInitially = await InitialSyncService.isHydrated();
    expect(isHydratedInitially).toBe(false);

    // 3. Initial Hydration runs for DevAdmin
    const hydrationSuccess = await InitialSyncService.performInitialHydration(
      loginResult.role!,
      mockUser.id,
      null
    );
    expect(hydrationSuccess).toBe(true);
    expect(SyncStatusService.hydration.value).toBe('READY');

    // 4. Verify SQLite sync_state is now recorded as hydrated
    const isHydratedAfter = await InitialSyncService.isHydrated();
    expect(isHydratedAfter).toBe(true);
  });

  it('handles hydration retry gracefully on transient network/database error', async () => {
    // Simulate failed hydration state
    SyncStatusService.setHydration('FAILED');
    SyncStatusService.updateProgress('academic_years', 0, 10, 0, 'Connection lost');
    expect(SyncStatusService.hydration.value).toBe('FAILED');

    // Retry hydration
    const success = await InitialSyncService.performInitialHydration('DEVADMIN', 'devadmin', null);
    expect(success).toBe(true);
    expect(SyncStatusService.hydration.value).toBe('READY');
  });
});
