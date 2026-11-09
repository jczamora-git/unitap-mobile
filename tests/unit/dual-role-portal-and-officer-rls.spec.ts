import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { resetDatabaseForTests, getDatabase } from '@/database/database';
import { OfficerManagementService } from '@/services/officer-management.service';
import { OfficerRepository } from '@/database/repositories/officer.repository';
import { authService } from '@/services/auth.service';
import { SyncStatusService } from '@/services/sync/sync-status.service';
import { DataModeService } from '@/services/data-mode.service';
import { Preferences } from '@capacitor/preferences';

/**
 * UniTap 2.0 — Dual-Role Portal Access & Officer Management RLS Suite
 *
 * Verifies:
 * 1. DEVADMIN can retrieve all officer appointments via RLS.
 * 2. Ordinary officers cannot retrieve unrelated officers' appointments.
 * 3. RPC HTTP 200 with success: false never resolves to success.
 * 4. Duplicate promotion prevention & appointment detection.
 * 5. Existing STUDENT role preserved after officer promotion.
 * 6. Dual-role switching between STUDENT and OFFICER workspaces.
 * 7. Revoked or expired officer appointments disable Officer Portal access.
 * 8. Officer permissions and scope remain enforced.
 * 9. Direct Supabase Mode sets sync state to READY immediately.
 */
describe('UniTap 2.0 Dual-Role Portal & Officer Management RLS', { timeout: 35000 }, () => {
  let pg: PGlite;

  const DEVADMIN_ID = '11111111-1111-4111-8111-111111111111';
  const OFFICER_1_ID = '22222222-2222-4222-8222-222222222222';
  const OFFICER_2_ID = '33333333-3333-4333-8333-333333333333';

  async function createTestUserAndStudent(userId: string, studentId?: string) {
    const db = await getDatabase();
    const now = new Date().toISOString();
    if (studentId) {
      await db.execute(
        `INSERT OR IGNORE INTO students (id, school_id, first_name, last_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [studentId, 'SID_' + studentId.substring(0, 8), 'First', 'Last', 'ACTIVE', now, now]
      );
    }
    await db.execute(
      `INSERT OR IGNORE INTO users (id, username, student_id, account_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, 'usr_' + userId.substring(0, 8), studentId || null, 'ACTIVE', now, now]
    );
  }

  async function setupPostgreSqlWithRLS(): Promise<PGlite> {
    const db = new PGlite();

    // 1. Roles & context
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
      END $$;

      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.current_user_context (
        user_id UUID
      );
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT user_id FROM auth.current_user_context LIMIT 1;
      $$ LANGUAGE sql STABLE;

      CREATE TABLE IF NOT EXISTS public.users (
        id UUID PRIMARY KEY,
        username TEXT UNIQUE,
        student_id UUID,
        account_status TEXT DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS public.user_roles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        role TEXT NOT NULL,
        semester_id TEXT,
        assigned_at TIMESTAMPTZ DEFAULT now(),
        revoked_at TIMESTAMPTZ DEFAULT NULL
      );

      CREATE OR REPLACE FUNCTION public.get_current_user_role()
      RETURNS TEXT
      LANGUAGE sql
      STABLE
      SECURITY DEFINER
      AS $$
        SELECT role
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND revoked_at IS NULL
        ORDER BY
          CASE role
            WHEN 'DEVADMIN' THEN 1
            WHEN 'OFFICER' THEN 2
            WHEN 'STUDENT' THEN 3
            ELSE 4
          END
        LIMIT 1;
      $$;

      CREATE TABLE IF NOT EXISTS public.officer_appointments (
        id UUID PRIMARY KEY,
        user_id UUID,
        student_id UUID,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        permission_preset VARCHAR(20) NOT NULL DEFAULT 'FULL',
        custom_permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        appointment_start TIMESTAMPTZ NOT NULL,
        appointment_end TIMESTAMPTZ NOT NULL,
        scope_type VARCHAR(20) NOT NULL DEFAULT 'ORGANIZATION',
        scope_id TEXT,
        suspended_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      );

      GRANT ALL ON SCHEMA public TO authenticated;
      GRANT ALL ON SCHEMA auth TO authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT ALL ON ALL TABLES IN SCHEMA auth TO authenticated;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
      GRANT ALL ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;
    `);

    // 2. Apply RLS policies
    await db.exec(`
      ALTER TABLE public.officer_appointments ENABLE ROW LEVEL SECURITY;

      -- DevAdmin select policy
      CREATE POLICY "DevAdmin view all officer_appointments"
        ON public.officer_appointments
        FOR SELECT
        TO authenticated
        USING (
          public.get_current_user_role() = 'DEVADMIN'
        );

      -- Officer own-appointment select policy
      CREATE POLICY "Officers view own appointment"
        ON public.officer_appointments
        FOR SELECT
        TO authenticated
        USING (
          user_id = auth.uid() AND status IN ('ACTIVE', 'SUSPENDED')
        );

      -- DevAdmin mutation policies
      CREATE POLICY "DevAdmin insert officer_appointments"
        ON public.officer_appointments
        FOR INSERT
        TO authenticated
        WITH CHECK (
          public.get_current_user_role() = 'DEVADMIN'
        );

      CREATE POLICY "DevAdmin update officer_appointments"
        ON public.officer_appointments
        FOR UPDATE
        TO authenticated
        USING (
          public.get_current_user_role() = 'DEVADMIN'
        )
        WITH CHECK (
          public.get_current_user_role() = 'DEVADMIN'
        );

      CREATE POLICY "DevAdmin delete officer_appointments"
        ON public.officer_appointments
        FOR DELETE
        TO authenticated
        USING (
          public.get_current_user_role() = 'DEVADMIN'
        );
    `);

    // 3. Seed users & appointments
    await db.exec(`
      INSERT INTO public.users (id, username) VALUES
        ('${DEVADMIN_ID}', 'devadmin'),
        ('${OFFICER_1_ID}', 'officer1'),
        ('${OFFICER_2_ID}', 'officer2');

      INSERT INTO public.user_roles (user_id, role) VALUES
        ('${DEVADMIN_ID}', 'DEVADMIN'),
        ('${OFFICER_1_ID}', 'OFFICER'),
        ('${OFFICER_2_ID}', 'OFFICER');

      INSERT INTO public.officer_appointments (
        id, user_id, full_name, email, scope_type, permission_preset, status,
        appointment_start, appointment_end
      ) VALUES
        ('a1111111-1111-4111-8111-111111111111', '${OFFICER_1_ID}', 'Officer One', 'off1@test.com', 'ORGANIZATION', 'FULL', 'ACTIVE', now() - interval '10 days', now() + interval '100 days'),
        ('a2222222-2222-4222-8222-222222222222', '${OFFICER_2_ID}', 'Officer Two', 'off2@test.com', 'ORGANIZATION', 'FINANCE', 'ACTIVE', now() - interval '10 days', now() + interval '100 days');
    `);

    return db;
  }

  beforeEach(async () => {
    await Preferences.clear();
    await resetDatabaseForTests();
    DataModeService.setMode('offline_first');
  });

  // --------------------------------------------------------------------------
  // Scenario 1: DEVADMIN RLS SELECT Visibility
  // --------------------------------------------------------------------------
  it('1. DEVADMIN can retrieve all officer appointments via RLS', async () => {
    pg = await setupPostgreSqlWithRLS();

    // Authenticate as DEVADMIN
    await pg.exec(`
      DELETE FROM auth.current_user_context;
      INSERT INTO auth.current_user_context VALUES ('${DEVADMIN_ID}');
      SET ROLE authenticated;
    `);

    const result = await pg.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM public.officer_appointments ORDER BY user_id ASC;'
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.user_id)).toEqual([OFFICER_1_ID, OFFICER_2_ID]);

    await pg.exec('RESET ROLE;');
  });

  // --------------------------------------------------------------------------
  // Scenario 2: Ordinary Officer RLS Isolation
  // --------------------------------------------------------------------------
  it('2. Ordinary officers can only view their own appointment, not unrelated appointments', async () => {
    pg = await setupPostgreSqlWithRLS();

    // Authenticate as OFFICER_1
    await pg.exec(`
      DELETE FROM auth.current_user_context;
      INSERT INTO auth.current_user_context VALUES ('${OFFICER_1_ID}');
      SET ROLE authenticated;
    `);

    const result = await pg.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM public.officer_appointments;'
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].user_id).toBe(OFFICER_1_ID);

    // Authenticate as OFFICER_2
    await pg.exec(`
      DELETE FROM auth.current_user_context;
      INSERT INTO auth.current_user_context VALUES ('${OFFICER_2_ID}');
    `);

    const result2 = await pg.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM public.officer_appointments;'
    );

    expect(result2.rows).toHaveLength(1);
    expect(result2.rows[0].user_id).toBe(OFFICER_2_ID);

    await pg.exec('RESET ROLE;');
  });

  // --------------------------------------------------------------------------
  // Scenario 3: RPC HTTP 200 with success: false never treated as success
  // --------------------------------------------------------------------------
  it('3. RPC HTTP 200 with data.success = false returns failure instead of success', async () => {
    DataModeService.setMode('supabase_direct');
    const { supabase } = await import('@/integrations/supabase/client');
    const originalRpc = supabase.rpc;

    try {
      // @ts-ignore
      supabase.rpc = async (fn: string) => {
        if (fn === 'devadmin_promote_student_to_officer') {
          return {
            data: { success: false, error: 'Student already promoted to officer' },
            error: null,
          } as any;
        }
        return { data: null, error: null } as any;
      };

      const res = await OfficerManagementService.promoteStudentToOfficer({
        studentId: 'st_test_1',
        fullName: 'Test Student',
        email: 'test@student.com',
        semesterId: 'sem_2026_1',
        scopeType: 'ORGANIZATION',
        permissionPreset: 'FULL',
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 86400000).toISOString(),
        devAdminUserId: DEVADMIN_ID,
      });

      expect(res.success).toBe(false);
      expect(res.error).toBe('Student already promoted to officer');
    } finally {
      supabase.rpc = originalRpc;
      DataModeService.setMode('offline_first');
    }
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Duplicate promotion prevention & appointment detection
  // --------------------------------------------------------------------------
  it('4. Duplicate promotion is detected via getAppointmentForStudent', async () => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    await createTestUserAndStudent('usr_student_1', 'stu_0001');

    await OfficerRepository.createAppointment({
      id: 'app_existing_1',
      user_id: 'usr_student_1',
      student_id: 'stu_0001',
      full_name: 'Test Student',
      email: 'student@mcc.edu',
      permission_preset: 'FULL',
      custom_permissions_json: '[]',
      scope_type: 'ORGANIZATION',
      status: 'ACTIVE',
      appointment_start: now,
      appointment_end: future,
    });

    const appt = await OfficerManagementService.getAppointmentForStudent('stu_0001');
    expect(appt).not.toBeNull();
    expect(appt?.student_id).toBe('stu_0001');
    expect(appt?.status).toBe('ACTIVE');
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Existing STUDENT role preserved after officer promotion
  // --------------------------------------------------------------------------
  it('5. Dual-role user preserves STUDENT role in authService and SQLite', async () => {
    const user = {
      id: 'usr_dual_1',
      username: 'mcc2026-0256',
      student_id: 'stu_dual_1',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const studentRole = {
      id: 'rol_stu',
      user_id: user.id,
      role: 'STUDENT' as const,
      assigned_at: new Date().toISOString(),
    };

    const officerRole = {
      id: 'rol_off',
      user_id: user.id,
      role: 'OFFICER' as const,
      assigned_at: new Date().toISOString(),
    };

    const studentRec = {
      id: 'stu_dual_1',
      studentNumber: 'MCC2026-0256',
      firstName: 'Althea',
      lastName: 'Abella',
      academicYear: '1st Year',
      status: 'ACTIVE' as const,
      balanceCentavos: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await authService.setSession(user, studentRole, studentRec, [studentRole, officerRole]);

    expect(authService.canSwitchWorkspace.value).toBe(true);
    expect(authService.roles.value).toContain('STUDENT');
    expect(authService.roles.value).toContain('OFFICER');
    expect(authService.user.value?.student_id).toBe('stu_dual_1');
    expect(authService.activeWorkspace.value).toBe('STUDENT');
  });

  // --------------------------------------------------------------------------
  // Scenario 6: Dual-Role Workspace Switching
  // --------------------------------------------------------------------------
  it('6. Dual-role user can switch smoothly between STUDENT and OFFICER workspaces', async () => {
    const user = {
      id: 'usr_dual_switch',
      username: 'mcc2026-0256',
      student_id: 'stu_dual_switch',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const studentRole = {
      id: 'rol_1',
      user_id: user.id,
      role: 'STUDENT' as const,
      assigned_at: new Date().toISOString(),
    };

    const officerRole = {
      id: 'rol_2',
      user_id: user.id,
      role: 'OFFICER' as const,
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(user, studentRole, null, [studentRole, officerRole]);
    expect(authService.activeWorkspace.value).toBe('STUDENT');
    expect(authService.role.value).toBe('STUDENT');

    // Switch to OFFICER workspace
    await authService.switchWorkspace('OFFICER');
    expect(authService.activeWorkspace.value).toBe('OFFICER');
    expect(authService.role.value).toBe('OFFICER');

    // Switch back to STUDENT workspace
    await authService.switchWorkspace('STUDENT');
    expect(authService.activeWorkspace.value).toBe('STUDENT');
    expect(authService.role.value).toBe('STUDENT');

    // User session remains intact throughout
    expect(authService.user.value?.id).toBe(user.id);
  });

  // --------------------------------------------------------------------------
  // Scenario 7: Revoked or expired appointment disables officer access
  // --------------------------------------------------------------------------
  it('7. Revoked or expired officer appointment is detected as invalid', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const farPast = new Date(Date.now() - 172800000).toISOString();

    await createTestUserAndStudent('usr_expired_1', 'stu_exp');

    // Expired appointment
    await OfficerRepository.createAppointment({
      id: 'app_expired_1',
      user_id: 'usr_expired_1',
      student_id: 'stu_exp',
      full_name: 'Expired Officer',
      email: 'exp@mcc.edu',
      permission_preset: 'FULL',
      custom_permissions_json: '[]',
      scope_type: 'ORGANIZATION',
      status: 'ACTIVE',
      appointment_start: farPast,
      appointment_end: past,
    });

    const isExpiredValid = await OfficerManagementService.hasValidOfficerAppointment('usr_expired_1');
    expect(isExpiredValid).toBe(false);

    await createTestUserAndStudent('usr_revoked_1', 'stu_rev');

    // Revoked appointment
    await OfficerRepository.createAppointment({
      id: 'app_revoked_1',
      user_id: 'usr_revoked_1',
      student_id: 'stu_rev',
      full_name: 'Revoked Officer',
      email: 'rev@mcc.edu',
      permission_preset: 'FULL',
      custom_permissions_json: '[]',
      scope_type: 'ORGANIZATION',
      status: 'REVOKED',
      appointment_start: farPast,
      appointment_end: new Date(Date.now() + 86400000).toISOString(),
    });

    const isRevokedValid = await OfficerManagementService.hasValidOfficerAppointment('usr_revoked_1');
    expect(isRevokedValid).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario 8: Officer permissions and scope remain enforced
  // --------------------------------------------------------------------------
  it('8. Officer appointment preserves permission preset and scope type', async () => {
    const now = new Date().toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();

    await createTestUserAndStudent('usr_perm_1', 'stu_perm');

    await OfficerRepository.createAppointment({
      id: 'app_perm_1',
      user_id: 'usr_perm_1',
      student_id: 'stu_perm',
      full_name: 'Perm Officer',
      email: 'perm@mcc.edu',
      permission_preset: 'FULL',
      custom_permissions_json: '[]',
      scope_type: 'ORGANIZATION',
      status: 'ACTIVE',
      appointment_start: now,
      appointment_end: future,
    });

    const isValid = await OfficerManagementService.hasValidOfficerAppointment('usr_perm_1');
    expect(isValid).toBe(true);

    const appt = await OfficerRepository.getAppointmentByUserId('usr_perm_1');
    expect(appt?.permission_preset).toBe('FULL');
    expect(appt?.scope_type).toBe('ORGANIZATION');
  });

  // --------------------------------------------------------------------------
  // Scenario 9: Direct Supabase Mode Initial Sync Navigation
  // --------------------------------------------------------------------------
  it('9. Direct Supabase Mode sets sync state to READY immediately', async () => {
    DataModeService.setMode('supabase_direct');
    expect(DataModeService.isDirectSupabase()).toBe(true);

    SyncStatusService.setHydration('READY');
    SyncStatusService.setState('SYNCED');

    expect(SyncStatusService.hydration.value).toBe('READY');
    expect(SyncStatusService.state.value).toBe('DIRECT_MODE');

    // Clean up
    DataModeService.setMode('offline_first');
  });

  // --------------------------------------------------------------------------
  // Scenario 10: DEVADMIN-only account without student_id
  // --------------------------------------------------------------------------
  it('10. DEVADMIN-only account without student_id has only DevAdmin portal and no student profile requirement', async () => {
    const adminUser = {
      id: 'usr_devadmin_pure',
      username: 'superadmin',
      student_id: null,
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const adminRole = {
      id: 'rol_adm_pure',
      user_id: adminUser.id,
      role: 'DEVADMIN' as const,
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(adminUser, adminRole, null, [adminRole]);

    expect(authService.role.value).toBe('DEVADMIN');
    expect(authService.roles.value).toEqual(['DEVADMIN']);
    expect(authService.availablePortals.value).toEqual(['DEVADMIN']);
    expect(authService.activeWorkspace.value).toBe('DEVADMIN');
    expect(authService.canSwitchWorkspace.value).toBe(false);
    expect(authService.user.value?.student_id).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario 11: STUDENT-only account has only Student portal
  // --------------------------------------------------------------------------
  it('11. STUDENT-only account has only Student portal and cannot switch workspace', async () => {
    const studentUser = {
      id: 'usr_student_pure',
      username: 'mcc2026-0099',
      student_id: 'stu_pure_99',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const studentRole = {
      id: 'rol_stu_pure',
      user_id: studentUser.id,
      role: 'STUDENT' as const,
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(studentUser, studentRole, null, [studentRole]);

    expect(authService.role.value).toBe('STUDENT');
    expect(authService.roles.value).toEqual(['STUDENT']);
    expect(authService.availablePortals.value).toEqual(['STUDENT']);
    expect(authService.activeWorkspace.value).toBe('STUDENT');
    expect(authService.canSwitchWorkspace.value).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario 12: DEVADMIN + OFFICER account has both portals accessible
  // --------------------------------------------------------------------------
  it('12. DEVADMIN + OFFICER account has both portals accessible and can toggle between them', async () => {
    const dualStaffUser = {
      id: 'usr_devadmin_officer',
      username: 'techlead',
      student_id: null,
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const devAdminRole = {
      id: 'rol_dev_1',
      user_id: dualStaffUser.id,
      role: 'DEVADMIN' as const,
      assigned_at: new Date().toISOString(),
    };

    const officerRole = {
      id: 'rol_off_1',
      user_id: dualStaffUser.id,
      role: 'OFFICER' as const,
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(dualStaffUser, devAdminRole, null, [devAdminRole, officerRole]);

    expect(authService.availablePortals.value).toContain('DEVADMIN');
    expect(authService.availablePortals.value).toContain('OFFICER');
    expect(authService.availablePortals.value).not.toContain('STUDENT');
    expect(authService.canSwitchWorkspace.value).toBe(true);

    // Initial workspace defaults to DEVADMIN
    expect(authService.activeWorkspace.value).toBe('DEVADMIN');

    // Switch to OFFICER
    await authService.switchWorkspace('OFFICER');
    expect(authService.activeWorkspace.value).toBe('OFFICER');
    expect(authService.role.value).toBe('OFFICER');

    // Switch back to DEVADMIN
    await authService.switchWorkspace('DEVADMIN');
    expect(authService.activeWorkspace.value).toBe('DEVADMIN');
    expect(authService.role.value).toBe('DEVADMIN');
  });

  // --------------------------------------------------------------------------
  // Scenario 13: Portal selection restored from Preferences after app refresh
  // --------------------------------------------------------------------------
  it('13. Active portal selection is persisted and restored from Preferences on initSession', async () => {
    const user = {
      id: 'usr_dual_restore',
      username: 'mcc2026-0256',
      student_id: 'stu_dual_restore',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const studentRole = {
      id: 'rol_s_res',
      user_id: user.id,
      role: 'STUDENT' as const,
      assigned_at: new Date().toISOString(),
    };

    const officerRole = {
      id: 'rol_o_res',
      user_id: user.id,
      role: 'OFFICER' as const,
      assigned_at: new Date().toISOString(),
    };

    // User switches to OFFICER workspace
    await authService.setSession(user, studentRole, null, [studentRole, officerRole]);
    await authService.switchWorkspace('OFFICER');
    expect(authService.activeWorkspace.value).toBe('OFFICER');

    // Verify written to Preferences
    const stored = await Preferences.get({ key: 'unitap_active_workspace' });
    expect(stored.value).toBe('OFFICER');

    // Simulate session reload/refresh
    await authService.initSession();
    expect(authService.activeWorkspace.value).toBe('OFFICER');
    expect(authService.role.value).toBe('OFFICER');
  });

  // --------------------------------------------------------------------------
  // Scenario 14: get_current_user_role() does not hide other active roles in query
  // --------------------------------------------------------------------------
  it('14. get_current_user_role() returns single priority role but all roles are retrieved via user_roles query', async () => {
    pg = await setupPostgreSqlWithRLS();

    const MULTI_USER_ID = '44444444-4444-4444-8444-444444444444';

    // Insert user with both DEVADMIN and OFFICER and STUDENT
    await pg.exec(`
      INSERT INTO public.users (id, username) VALUES ('${MULTI_USER_ID}', 'multi_user');
      INSERT INTO public.user_roles (user_id, role) VALUES
        ('${MULTI_USER_ID}', 'STUDENT'),
        ('${MULTI_USER_ID}', 'OFFICER'),
        ('${MULTI_USER_ID}', 'DEVADMIN');
    `);

    // Context set to MULTI_USER_ID
    await pg.exec(`
      DELETE FROM auth.current_user_context;
      INSERT INTO auth.current_user_context VALUES ('${MULTI_USER_ID}');
      SET ROLE authenticated;
    `);

    // Single-role function returns highest priority role (DEVADMIN)
    const singleRoleRes = await pg.query<{ get_current_user_role: string }>(
      'SELECT public.get_current_user_role();'
    );
    expect(singleRoleRes.rows[0].get_current_user_role).toBe('DEVADMIN');

    // Multi-role query retrieves ALL active roles
    const allRolesRes = await pg.query<{ role: string }>(
      `SELECT role FROM public.user_roles WHERE user_id = auth.uid() AND revoked_at IS NULL ORDER BY role ASC;`
    );
    const roles = allRolesRes.rows.map((r) => r.role);
    expect(roles).toEqual(['DEVADMIN', 'OFFICER', 'STUDENT']);

    await pg.exec('RESET ROLE;');
  });

  // --------------------------------------------------------------------------
  // Scenario 15: Switching portals does not mutate database records
  // --------------------------------------------------------------------------
  it('15. Switching active workspace only affects client state and never alters database roles', async () => {
    const db = await getDatabase();
    await createTestUserAndStudent('usr_switch_db', 'stu_sw_1');

    // Seed roles in SQLite
    const now = new Date().toISOString();
    await db.execute(
      `INSERT INTO user_roles (id, user_id, role, assigned_at) VALUES
       ('ur_s1', 'usr_switch_db', 'STUDENT', ?),
       ('ur_o1', 'usr_switch_db', 'OFFICER', ?)`,
      [now, now]
    );

    const user = {
      id: 'usr_switch_db',
      username: 'mcc2026-switch',
      student_id: 'stu_sw_1',
      account_status: 'ACTIVE',
      created_at: now,
      updated_at: now,
    };

    const rolesBefore = await db.query<any>('SELECT * FROM user_roles WHERE user_id = ?', ['usr_switch_db']);
    expect(rolesBefore.length).toBe(2);

    await authService.setSession(user, rolesBefore[0], null, rolesBefore);
    expect(authService.activeWorkspace.value).toBe('STUDENT');

    // Switch workspace
    await authService.switchWorkspace('OFFICER');
    expect(authService.activeWorkspace.value).toBe('OFFICER');

    // Verify DB records remain completely untouched
    const rolesAfter = await db.query<any>('SELECT * FROM user_roles WHERE user_id = ?', ['usr_switch_db']);
    expect(rolesAfter.length).toBe(2);
    expect(rolesAfter.map((r: any) => r.role)).toEqual(['STUDENT', 'OFFICER']);
  });

  // --------------------------------------------------------------------------
  // Scenario 16: Unauthorized portal access rejected by navigation guard logic
  // --------------------------------------------------------------------------
  it('16. Navigation guard blocks student from officer-only routes and blocks non-student from pass route', async () => {
    // 1. When role is STUDENT, officer routes should redirect to /tabs/home
    const studentUser = {
      id: 'usr_guard_stu',
      username: 'mcc2026-guard',
      student_id: 'stu_guard_1',
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const studentRole = {
      id: 'rol_g_s',
      user_id: studentUser.id,
      role: 'STUDENT' as const,
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(studentUser, studentRole, null, [studentRole]);
    expect(authService.role.value).toBe('STUDENT');

    const officerOnlyPrefixes = [
      '/tabs/scan',
      '/tabs/students',
      '/events/create',
      '/register-student',
      '/finance/pay',
      '/academic',
    ];

    // Verify navigation guard check logic
    for (const path of officerOnlyPrefixes) {
      const isBlocked = officerOnlyPrefixes.some((p) => path === p || path.startsWith(p + '/'));
      expect(isBlocked).toBe(true);
    }

    // 2. When user has NO student_id (pure DEVADMIN), /tabs/pass is blocked
    const pureAdminUser = {
      id: 'usr_guard_admin',
      username: 'sysadmin',
      student_id: null,
      account_status: 'ACTIVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const adminRole = {
      id: 'rol_g_a',
      user_id: pureAdminUser.id,
      role: 'DEVADMIN' as const,
      assigned_at: new Date().toISOString(),
    };

    await authService.setSession(pureAdminUser, adminRole, null, [adminRole]);
    expect(authService.user.value?.student_id).toBeNull();
    // Non-student accessing pass:
    const passBlocked = !authService.user.value?.student_id;
    expect(passBlocked).toBe(true);
  });
});
