import { ref, computed } from 'vue';
import { getDatabase } from '@/database/database';
import { PullSyncService, type SyncEntityName } from './pull-sync.service';
import { EntityCheckpointService } from './entity-checkpoint.service';
import { SyncScopeService, type UserRole } from './sync-scope.service';
import { OperationPolicyService } from '../operation-policy.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { studentService } from '../student.service';

export type SyncDomain = 'STUDENTS' | 'EVENTS' | 'ACADEMIC' | 'FINANCE_REFERENCE' | 'ATTENDANCE';

export const DOMAIN_ENTITIES: Record<SyncDomain, SyncEntityName[]> = {
  STUDENTS: ['students', 'student_enrollments', 'nfc_cards'],
  EVENTS: ['events', 'event_occurrences', 'event_categories', 'event_participants'],
  ACADEMIC: ['academic_years', 'semesters', 'programs', 'year_levels', 'sections'],
  FINANCE_REFERENCE: ['obligation_rules', 'student_obligations'],
  ATTENDANCE: ['attendance_records', 'attendance_audit'],
};

export type EntityRefreshStatus = 'IDLE' | 'REFRESHING' | 'UP_TO_DATE' | 'ERROR' | 'OFFLINE';

export interface EntityRefreshMetadata {
  entity: string;
  lastRefreshedAt: number; // epoch ms
  isRefreshing: boolean;
  recordsPulled: number;
  lastError: string | null;
  status: EntityRefreshStatus;
}

export interface SelectiveRefreshResult {
  refreshed: boolean;
  recordsPulled: number;
  entitiesProcessed: string[];
  reason?: 'FRESH' | 'OFFLINE' | 'UNAUTHORIZED' | 'SUCCESS' | 'ERROR';
  error?: string;
  cachedAvailable: boolean;
}

export interface SelectiveSyncOptions {
  force?: boolean;
  ttlMs?: number;
  pageSize?: number;
}

export class SelectiveSyncService {
  // Default TTL: 5 minutes (300,000 ms) to avoid redundant requests on navigation
  public static readonly DEFAULT_TTL_MS = 5 * 60 * 1000;

  private static metadataMap = ref<Record<string, EntityRefreshMetadata>>({});
  private static inFlightPromises = new Map<string, Promise<SelectiveRefreshResult>>();

  /**
   * Returns reactive refresh metadata for an entity.
   */
  public static getEntityMetadata(entity: string): EntityRefreshMetadata {
    if (!this.metadataMap.value[entity]) {
      this.metadataMap.value[entity] = {
        entity,
        lastRefreshedAt: 0,
        isRefreshing: false,
        recordsPulled: 0,
        lastError: null,
        status: 'IDLE',
      };
    }
    return this.metadataMap.value[entity];
  }

  /**
   * Computed helper to inspect domain-level refreshing state.
   */
  public static isDomainRefreshing(domain: SyncDomain) {
    return computed(() => {
      const entities = DOMAIN_ENTITIES[domain] || [];
      return entities.some((e) => this.metadataMap.value[e]?.isRefreshing);
    });
  }

  /**
   * Computed helper to inspect domain-level last refreshed timestamp.
   */
  public static getDomainLastRefreshed(domain: SyncDomain) {
    return computed(() => {
      const entities = DOMAIN_ENTITIES[domain] || [];
      let latest = 0;
      for (const e of entities) {
        const t = this.metadataMap.value[e]?.lastRefreshedAt || 0;
        if (t > latest) latest = t;
      }
      return latest > 0 ? new Date(latest).toISOString() : null;
    });
  }

  /**
   * Refreshes a single entity domain (e.g. STUDENTS, EVENTS, ACADEMIC)
   * if online, stale, or explicitly forced.
   */
  public static async refreshDomain(
    domain: SyncDomain,
    options?: SelectiveSyncOptions
  ): Promise<SelectiveRefreshResult> {
    const entities = DOMAIN_ENTITIES[domain] || [];
    return this.refreshEntities(entities, options, `DOMAIN_${domain}`);
  }

  /**
   * Dedicated shortcut to refresh students, enrollments, and cards.
   */
  public static async refreshStudents(force = false): Promise<SelectiveRefreshResult> {
    return this.refreshDomain('STUDENTS', { force });
  }

  /**
   * Dedicated shortcut to refresh events, occurrences, and participants.
   */
  public static async refreshEvents(force = false): Promise<SelectiveRefreshResult> {
    return this.refreshDomain('EVENTS', { force });
  }

  /**
   * Dedicated shortcut to refresh academic structures (semesters, programs, sections).
   */
  public static async refreshAcademic(force = false): Promise<SelectiveRefreshResult> {
    return this.refreshDomain('ACADEMIC', { force });
  }

  /**
   * Dedicated shortcut to refresh finance reference ledger (rules and obligations).
   * Note: Payments and reversals remain strictly online/server-confirmed.
   */
  public static async refreshFinanceReference(force = false): Promise<SelectiveRefreshResult> {
    return this.refreshDomain('FINANCE_REFERENCE', { force });
  }

  /**
   * Dedicated shortcut to refresh attendance audit records.
   * Note: Preserves the offline NFC attendance scanning pipeline.
   */
  public static async refreshAttendance(force = false): Promise<SelectiveRefreshResult> {
    return this.refreshDomain('ATTENDANCE', { force });
  }

  /**
   * Core selective refresh orchestrator with:
   * - Staleness TTL check (prevents redundant navigation fetch)
   * - Single-flight lock (prevents concurrent duplicate fetch)
   * - Offline fail-soft (retains usable cached data without throwing)
   * - Role/scope authorization filter (prevents unauthorized table pull)
   */
  public static async refreshEntities(
    entities: SyncEntityName[],
    options?: SelectiveSyncOptions,
    coalesceKey?: string
  ): Promise<SelectiveRefreshResult> {
    const key = coalesceKey || entities.slice().sort().join(',');

    // 1. Single-Flight Lock: Coalesce concurrent duplicate calls into a single execution
    if (this.inFlightPromises.has(key)) {
      return this.inFlightPromises.get(key)!;
    }

    const promise = this.executeRefresh(entities, options, key);
    this.inFlightPromises.set(key, promise);

    try {
      return await promise;
    } finally {
      this.inFlightPromises.delete(key);
    }
  }

  private static async executeRefresh(
    entities: SyncEntityName[],
    options?: SelectiveSyncOptions,
    _key?: string
  ): Promise<SelectiveRefreshResult> {
    const force = Boolean(options?.force);
    const ttlMs = options?.ttlMs ?? this.DEFAULT_TTL_MS;
    const now = Date.now();

    // 2. Offline Detection: Fail-soft and retain cached SQLite records
    const isOnline = OperationPolicyService.isOnline.value;
    if (!isOnline) {
      for (const e of entities) {
        const meta = this.getEntityMetadata(e);
        meta.status = 'OFFLINE';
      }
      return {
        refreshed: false,
        recordsPulled: 0,
        entitiesProcessed: [],
        reason: 'OFFLINE',
        cachedAvailable: true,
      };
    }

    // 3. Staleness Check: Identify which entities are genuinely stale
    const staleEntities: SyncEntityName[] = [];
    for (const e of entities) {
      const meta = this.getEntityMetadata(e);
      const isStale = force || now - meta.lastRefreshedAt >= ttlMs;
      if (isStale) {
        staleEntities.push(e);
      }
    }

    if (staleEntities.length === 0) {
      return {
        refreshed: false,
        recordsPulled: 0,
        entitiesProcessed: [],
        reason: 'FRESH',
        cachedAvailable: true,
      };
    }

    // 4. Role & Scope Authorization Check
    const role: UserRole = (SupabaseAuthService.role.value as UserRole) || 'STUDENT';
    const allowedTables = new Set<string>(SyncScopeService.getRequiredTablesForRole(role));
    const authorizedEntities = staleEntities.filter((e) => allowedTables.has(e));

    if (authorizedEntities.length === 0) {
      for (const e of staleEntities) {
        const meta = this.getEntityMetadata(e);
        meta.status = 'ERROR';
        meta.lastError = `Unauthorized: Table ${e} is not permitted for role ${role}`;
      }
      return {
        refreshed: false,
        recordsPulled: 0,
        entitiesProcessed: [],
        reason: 'UNAUTHORIZED',
        error: `Caller lacks permission to synchronize requested entities under role ${role}.`,
        cachedAvailable: true,
      };
    }

    // 5. Execute selective pull for authorized stale entities
    let totalRecordsPulled = 0;
    const processed: string[] = [];
    let hasFailure = false;
    let firstError: string | undefined;

    for (const entity of authorizedEntities) {
      const meta = this.getEntityMetadata(entity);
      meta.isRefreshing = true;
      meta.status = 'REFRESHING';

      try {
        const db = await getDatabase();
        // Uses incremental delta sync with checkpoint cursor (updated_at > last_pulled_at)
        const res = await PullSyncService.syncEntity(db, entity, { pageSize: options?.pageSize });

        if (res.status === 'SUCCESS' || res.status === 'PARTIAL_PENDING_OUTBOX') {
          meta.lastRefreshedAt = Date.now();
          meta.recordsPulled = res.recordsPulled;
          meta.lastError = null;
          meta.status = 'UP_TO_DATE';
          totalRecordsPulled += res.recordsPulled;
          processed.push(entity);
        } else {
          hasFailure = true;
          meta.status = 'ERROR';
          meta.lastError = res.errorMessage || 'Entity refresh failed';
          firstError = firstError || res.errorMessage;
        }
      } catch (err: unknown) {
        hasFailure = true;
        const msg = err instanceof Error ? err.message : String(err);
        meta.status = 'ERROR';
        meta.lastError = msg;
        firstError = firstError || msg;
        console.warn(`[SelectiveSync] Refresh error for ${entity}:`, msg);
      } finally {
        meta.isRefreshing = false;
      }
    }

    if (hasFailure && processed.length === 0) {
      return {
        refreshed: false,
        recordsPulled: 0,
        entitiesProcessed: [],
        reason: 'ERROR',
        error: firstError,
        cachedAvailable: true,
      };
    }

    return {
      refreshed: processed.length > 0,
      recordsPulled: totalRecordsPulled,
      entitiesProcessed: processed,
      reason: hasFailure ? 'ERROR' : 'SUCCESS',
      error: firstError,
      cachedAvailable: true,
    };
  }

  // ============================================================================
  // SESSION, ROLE, AND SEMESTER INVALIDATION
  // ============================================================================

  /**
   * Invalidates cached refresh timestamps for a domain, forcing a fresh pull next time.
   */
  public static invalidateDomain(domain: SyncDomain): void {
    const entities = DOMAIN_ENTITIES[domain] || [];
    for (const e of entities) {
      const meta = this.getEntityMetadata(e);
      meta.lastRefreshedAt = 0;
      meta.status = 'IDLE';
    }
  }

  /**
   * Clears all in-memory refresh metadata across all entities.
   */
  public static invalidateAll(): void {
    this.metadataMap.value = {};
    this.inFlightPromises.clear();
  }

  /**
   * Enforces security invalidation when role, appointment, or user changes.
   * Clears student cache and resets refresh timestamps to prevent unauthorized reads.
   */
  public static handleSessionChange(newRole?: UserRole | null): void {
    this.invalidateAll();
    studentService.clearCache();

    if (!newRole || newRole === 'STUDENT') {
      // If downgraded to student or logged out, ensure restricted tables are marked
      const restricted = ['nfc_cards', 'obligation_rules', 'payment_allocations'];
      for (const table of restricted) {
        const meta = this.getEntityMetadata(table);
        meta.status = 'IDLE';
        meta.lastRefreshedAt = 0;
      }
    }
  }

  /**
   * Enforces semester switch invalidation:
   * Invalidates semester-dependent domains (STUDENTS, EVENTS, FINANCE_REFERENCE).
   */
  public static handleSemesterChange(): void {
    this.invalidateDomain('STUDENTS');
    this.invalidateDomain('EVENTS');
    this.invalidateDomain('FINANCE_REFERENCE');
    studentService.clearCache();
  }
}

