import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { studentService } from '@/services/student.service';
import { useStudents } from '@/composables/useStudents';
import { DataModeService } from '@/services/data-mode.service';
import { StudentsRepository } from '@/database/repositories/students.repository';
import { supabase } from '@/integrations/supabase/client';

function createMockBuilder(result: { data: any; error: any }) {
  const promise = Promise.resolve(result);
  const builder: any = promise;
  builder.order = vi.fn().mockReturnValue(promise);
  builder.eq = vi.fn().mockReturnValue(promise);
  builder.ilike = vi.fn().mockReturnValue(promise);
  builder.or = vi.fn().mockReturnValue(promise);
  return builder;
}

function createChainableMock(result: { data: any; error: any }) {
  const promise = Promise.resolve(result);
  const handler: any = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    select: vi.fn().mockImplementation(() => handler),
    eq: vi.fn().mockImplementation(() => handler),
    neq: vi.fn().mockImplementation(() => handler),
    in: vi.fn().mockImplementation(() => handler),
    order: vi.fn().mockImplementation(() => handler),
    ilike: vi.fn().mockImplementation(() => handler),
    or: vi.fn().mockImplementation(() => handler),
    maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(result)),
    single: vi.fn().mockImplementation(() => Promise.resolve(result)),
  };
  return handler;
}

describe('Direct Supabase Student Reading Diagnostic & Integrity', () => {
  const originalFrom = supabase.from;
  const originalRpc = (supabase as any).rpc;

  beforeEach(() => {
    DataModeService.setMode('supabase_direct');
  });

  afterEach(async () => {
    supabase.from = originalFrom;
    (supabase as any).rpc = originalRpc;
    const { OperationPolicyService } = await import('@/services/operation-policy.service');
    OperationPolicyService.setMockOfflineOverride(null);
    DataModeService.setMode('offline_first');
    vi.restoreAllMocks();
  });

  it('1. fetchStudentsDirect checks and propagates errors from all four requests (students, enrollments, programs, cards)', async () => {
    // 1a. Test students error
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue(createMockBuilder({ data: null, error: { message: 'RLS blocked students query' } })),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    await expect(studentService.getStudents()).rejects.toThrow('Failed to query students from Supabase: RLS blocked students query');

    // 1b. Test enrollments error
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'student_enrollments') {
        return {
          select: vi.fn().mockReturnValue(createMockBuilder({ data: null, error: { message: 'user_roles permission denied on enrollments' } })),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    await expect(studentService.getStudents()).rejects.toThrow('Failed to query student enrollments from Supabase: user_roles permission denied on enrollments');

    // 1c. Test programs error
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'programs') {
        return {
          select: vi.fn().mockReturnValue(createMockBuilder({ data: null, error: { message: 'programs relation error' } })),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    await expect(studentService.getStudents()).rejects.toThrow('Failed to query programs from Supabase: programs relation error');

    // 1d. Test cards error
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'nfc_cards') {
        return {
          select: vi.fn().mockReturnValue(createMockBuilder({ data: null, error: { message: 'cards permission denied' } })),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    await expect(studentService.getStudents()).rejects.toThrow('Failed to query NFC cards from Supabase: cards permission denied');
  });

  it('2. useStudents.loadStudents preserves error and throws instead of returning empty array', async () => {
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue(createMockBuilder({ data: null, error: { message: 'Simulated Supabase connection error' } })),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    const { loadStudents, error } = useStudents();
    await expect(loadStudents()).rejects.toThrow('Simulated Supabase connection error');
    expect(error.value).toContain('Simulated Supabase connection error');
  });

  it('3. StudentsRepository.getStudentsByCanonicalSchoolId routes to Supabase in Direct Mode and prevents SQLite leakage', async () => {
    const mockOr = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'stu-uuid-1',
          school_id: 'MCC2026-0001',
          first_name: 'John',
          last_name: 'Doe',
          status: 'ACTIVE',
          created_at: '2026-11-08T00:00:00Z',
          updated_at: '2026-11-08T00:00:00Z',
        },
      ],
      error: null,
    });

    supabase.from = vi.fn().mockImplementation((table: string) => {
      expect(table).toBe('students');
      return {
        select: vi.fn().mockReturnValue({
          or: mockOr,
        }),
      };
    });

    const results = await StudentsRepository.getStudentsByCanonicalSchoolId('MCC-2026-0001');
    expect(supabase.from).toHaveBeenCalledWith('students');
    expect(mockOr).toHaveBeenCalled();
    expect(results.length).toBe(1);
    expect(results[0].school_id).toBe('MCC2026-0001');
  });

  it('4. StudentsRepository.getStudents in Direct Mode checks all errors from Supabase', async () => {
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [{ id: 'stu-1' }], error: null }),
          }),
        };
      }
      if (table === 'student_enrollments') {
        return {
          select: vi.fn().mockResolvedValue({ data: null, error: { message: 'Enrollment RLS policy failed' } }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    await expect(StudentsRepository.getStudents()).rejects.toThrow(
      'Failed to query student enrollments from Supabase: Enrollment RLS policy failed'
    );
  });

  it('5. EventService.createEvent in Direct Mode generates raw UUID and excludes description from Supabase INSERT payload', async () => {
    let capturedPayload: any = null;

    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'semesters') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'sem-2026-1' }, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === 'events') {
        return {
          insert: vi.fn().mockImplementation((payload: any) => {
            capturedPayload = payload;
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    const { EventService } = await import('@/services/event.service');
    const service = new EventService();

    const created = await service.createEvent({
      title: 'CSG Orientation 2026',
      description: 'Annual freshman welcome orientation',
      type: 'Orientation',
      audience: { type: 'ALL_BSIT' },
      attendanceRequired: true,
    });

    // 1. Verify returned UI model preserves description and raw UUID
    expect(created.title).toBe('CSG Orientation 2026');
    expect(created.description).toBe('Annual freshman welcome orientation');
    expect(created.id).not.toMatch(/^evt_/);
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    // 2. Verify Supabase payload does NOT contain description (preventing PGRST204)
    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.id).toBe(created.id);
    expect(capturedPayload.id).not.toMatch(/^evt_/);
    expect(capturedPayload.description).toBeUndefined();
    expect(capturedPayload).not.toHaveProperty('description');

    // 3. Verify only supported columns are present
    expect(capturedPayload).toEqual({
      id: created.id,
      semester_id: 'sem-2026-1',
      title: 'CSG Orientation 2026',
      event_type: 'Orientation',
      audience_type: 'ALL_BSIT',
      audience_json: { type: 'ALL_BSIT' },
      attendance_required: 1,
      status: 'ACTIVE',
      created_at: created.createdAt,
      updated_at: created.updatedAt,
    });
  });

  it('6. EventsRepository.toSupabaseEventPayload strips evt_ prefix and excludes description', async () => {
    const { EventsRepository } = await import('@/database/repositories/events.repository');

    const mapped = EventsRepository.toSupabaseEventPayload({
      id: 'evt_a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      semester_id: 'sem-uuid-1',
      title: 'Sportsfest Opening',
      description: 'College sportsfest opening ceremony',
      event_type: 'Sportsfest',
      category_id: 'cat-uuid-1',
      audience_type: 'ALL',
      audience_json: JSON.stringify({ type: 'ALL_BSIT' }),
      attendance_required: 1,
      status: 'ACTIVE',
      created_by_user_id: 'user-uuid-1',
      created_at: '2026-11-08T00:00:00Z',
      updated_at: '2026-11-08T00:00:00Z',
    });

    expect(mapped.id).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    expect(mapped.id).not.toMatch(/^evt_/);
    expect(mapped).not.toHaveProperty('description');
    expect(mapped).not.toHaveProperty('created_by_user_id');
    expect(mapped.title).toBe('Sportsfest Opening');
    expect(mapped.category_id).toBe('cat-uuid-1');
  });

  it('7. EventService.createOccurrence in Direct Mode generates raw UUID and strips evt_ prefix from parent event_id', async () => {
    let capturedOccurrencePayload: any = null;

    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'events') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'd88e5d81-4321-4f9e-9988-123456789abc',
                  title: 'CSG Orientation 2026',
                  event_type: 'Orientation',
                  status: 'ACTIVE',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'event_occurrences') {
        return {
          insert: vi.fn().mockImplementation((payload: any) => {
            capturedOccurrencePayload = payload;
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    const { EventService } = await import('@/services/event.service');
    const service = new EventService();

    // Call with prefixed eventId to ensure it strips it cleanly
    const occurrence = await service.createOccurrence({
      eventId: 'evt_d88e5d81-4321-4f9e-9988-123456789abc',
      title: 'Morning Check-in Session',
      date: '2026-11-15',
      startTime: '08:00',
      endTime: '12:00',
      gracePeriodMinutes: 30,
    });

    // 1. Verify returned occurrence has raw UUID (no occ_ prefix)
    expect(occurrence.id).not.toMatch(/^occ_/);
    expect(occurrence.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(occurrence.eventId).toBe('d88e5d81-4321-4f9e-9988-123456789abc');
    expect(occurrence.eventId).not.toMatch(/^evt_/);

    // 2. Verify payload sent to Supabase
    expect(capturedOccurrencePayload).toBeDefined();
    expect(capturedOccurrencePayload.id).toBe(occurrence.id);
    expect(capturedOccurrencePayload.id).not.toMatch(/^occ_/);
    expect(capturedOccurrencePayload.event_id).toBe('d88e5d81-4321-4f9e-9988-123456789abc');
    expect(capturedOccurrencePayload.event_id).not.toMatch(/^evt_/);
    expect(capturedOccurrencePayload.title).toBe('Morning Check-in Session');
    expect(capturedOccurrencePayload.occurs_on).toBe('2026-11-15');
    expect(capturedOccurrencePayload.starts_at).toBe('08:00');
    expect(capturedOccurrencePayload.ends_at).toBe('12:00');
    expect(capturedOccurrencePayload.grace_minutes).toBe(30);
    expect(capturedOccurrencePayload.status).toBe('SCHEDULED');
  });

  it('8. EventsRepository.toSupabaseOccurrencePayload strips occ_ and evt_ prefixes cleanly', async () => {
    const { EventsRepository } = await import('@/database/repositories/events.repository');

    const mapped = EventsRepository.toSupabaseOccurrencePayload({
      id: 'occ_11287077-5fa9-4560-8b71-93822dbdeb20',
      event_id: 'evt_d88e5d81-4321-4f9e-9988-123456789abc',
      title: 'Afternoon Check-out Session',
      occurs_on: '2026-11-15',
      starts_at: '13:00',
      ends_at: '17:00',
      grace_minutes: 15,
      status: 'SCHEDULED',
      opened_at: null,
      closed_at: null,
      updated_at: '2026-11-08T00:00:00Z',
    });

    expect(mapped.id).toBe('11287077-5fa9-4560-8b71-93822dbdeb20');
    expect(mapped.id).not.toMatch(/^occ_/);
    expect(mapped.event_id).toBe('d88e5d81-4321-4f9e-9988-123456789abc');
    expect(mapped.event_id).not.toMatch(/^evt_/);
    expect(mapped.title).toBe('Afternoon Check-out Session');
    expect(mapped.grace_minutes).toBe(15);
  });

  it('9. OfficerManagementService.promoteStudentToOfficer calls devadmin_promote_student_to_officer RPC in Direct Supabase mode', async () => {
    const { OperationPolicyService } = await import('@/services/operation-policy.service');
    OperationPolicyService.setMockOfflineOverride(false);

    let calledRpc = '';
    let calledParams: any = null;

    (supabase as any).rpc = vi.fn().mockImplementation((fn: string, params: any) => {
      calledRpc = fn;
      calledParams = params;
      return Promise.resolve({
        data: {
          success: true,
          appointment_id: 'appt-uuid-1234',
          user_id: 'user-uuid-5678',
          student_id: 'stu-uuid-0001',
          officer_name: 'Maria Santos',
          status: 'ACTIVE',
        },
        error: null,
      });
    });

    const { OfficerManagementService } = await import('@/services/officer-management.service');
    const result = await OfficerManagementService.promoteStudentToOfficer({
      studentId: 'stu-uuid-0001',
      userId: 'user-uuid-5678',
      fullName: 'Maria Santos',
      email: 'maria.santos@univ.edu',
      permissionPreset: 'FINANCE',
      startDate: '2026-11-01',
      endDate: '2027-05-31',
      scopeType: 'ORGANIZATION',
      devAdminUserId: 'devadmin-uuid-9999',
    });

    expect(result.success).toBe(true);
    expect(result.appointment.id).toBe('appt-uuid-1234');
    expect(result.appointment.status).toBe('ACTIVE');
    expect(calledRpc).toBe('devadmin_promote_student_to_officer');
    expect(calledParams).toEqual({
      p_student_id: 'stu-uuid-0001',
      p_user_id: 'user-uuid-5678',
      p_full_name: 'Maria Santos',
      p_email: 'maria.santos@univ.edu',
      p_permission_preset: 'FINANCE',
      p_custom_permissions: expect.any(Array),
      p_academic_year_id: null,
      p_semester_id: null,
      p_appointment_start: '2026-11-01',
      p_appointment_end: '2027-05-31',
      p_scope_type: 'ORGANIZATION',
      p_scope_id: null,
    });
  });

  it('10. OfficerManagementService.searchCandidates queries Supabase students, users, and officer appointments in Direct Mode', async () => {
    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                or: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'stu-1',
                        school_id: 'MCC-2026-0001',
                        first_name: 'Juan',
                        middle_name: 'A',
                        last_name: 'Dela Cruz',
                        status: 'ACTIVE',
                      },
                      {
                        id: 'stu-2',
                        school_id: 'MCC-2026-0002',
                        first_name: 'Maria',
                        middle_name: 'B',
                        last_name: 'Santos',
                        status: 'ACTIVE',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'users') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'user-1',
                  username: 'juan.delacruz@mcc.edu',
                  student_id: 'stu-1',
                  account_status: 'ACTIVE',
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'officer_appointments') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [
                  {
                    student_id: 'stu-1',
                    user_id: 'user-1',
                    status: 'ACTIVE',
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    const { OfficerManagementService } = await import('@/services/officer-management.service');
    const candidates = await OfficerManagementService.searchCandidates('Dela', 10);

    expect(candidates).toHaveLength(2);
    // stu-1 is registered and active officer
    expect(candidates[0].student_id).toBe('stu-1');
    expect(candidates[0].user_id).toBe('user-1');
    expect(candidates[0].is_registered).toBe(1);
    expect(candidates[0].is_officer).toBe(1);

    // stu-2 is roster only (not registered, not officer)
    expect(candidates[1].student_id).toBe('stu-2');
    expect(candidates[1].user_id).toBeNull();
    expect(candidates[1].is_registered).toBe(0);
    expect(candidates[1].is_officer).toBe(0);
  });

  it('11. NetworkService.checkServerReachability uses configured Supabase client and does not emit raw HEAD /rest/v1/', async () => {
    let rpcCalled = '';
    const originalFetch = global.fetch;
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
    global.fetch = fetchSpy;

    (supabase as any).rpc = vi.fn().mockImplementation((fn: string) => {
      rpcCalled = fn;
      return Promise.resolve({
        data: 'DEVADMIN',
        error: null,
        status: 200,
      });
    });

    const { NetworkService } = await import('@/services/network.service');
    const isReachable = await NetworkService.checkServerReachability(2000);

    expect(isReachable).toBe(true);
    expect(rpcCalled).toBe('get_current_user_role');
    // Verify that raw HEAD /rest/v1/ was NEVER called
    expect(fetchSpy).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it('12. FinanceRepository.assessBulkContributions in Direct Supabase mode inserts individual student obligations with UUIDs', async () => {
    let capturedObligations: any[] = [];
    const stagesReported: string[] = [];

    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'student_enrollments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'stu-uuid-1' },
                { student_id: 'stu-uuid-2' },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { id: 'stu-uuid-1' },
                  { id: 'stu-uuid-2' },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_obligations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
          insert: vi.fn().mockImplementation((rows: any[]) => {
            capturedObligations.push(...rows);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    const { FinanceRepository } = await import('@/database/repositories/finance.repository');
    const result = await FinanceRepository.assessBulkContributions(
      {
        semesterId: 'sem-uuid-1',
        ruleId: 'rule-uuid-1',
        title: 'CSG Membership Fee',
        amountCentavos: 15000,
        dueDate: '2026-12-15',
        targetScope: 'ALL',
        actorUserId: '00000000-0000-0000-0000-000000000001',
      },
      undefined,
      (stage) => stagesReported.push(stage)
    );

    expect(result.totalAssigned).toBe(2);
    expect(result.totalCentavos).toBe(30000);
    expect(capturedObligations).toHaveLength(2);

    // Verify raw UUIDs and supported columns (no batch_c_ text prefixes)
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const ob of capturedObligations) {
      expect(ob.id).toMatch(UUID_REGEX);
      expect(ob.batch_id).toMatch(UUID_REGEX);
      expect(ob.batch_id).not.toMatch(/^batch_c_/);
      expect(ob.semester_id).toBe('sem-uuid-1');
      expect(ob.rule_id).toBe('rule-uuid-1');
      expect(ob.title).toBe('CSG Membership Fee');
      expect(ob.type).toBe('CONTRIBUTION');
      expect(ob.amount_centavos).toBe(15000);
      expect(ob.status).toBe('ACTIVE');
      expect(ob.due_date).toBe('2026-12-15');
    }

    expect(stagesReported).toContain('LOADING_STUDENTS');
    expect(stagesReported).toContain('GENERATING_OBLIGATIONS');
    expect(stagesReported).toContain('SAVING_SUPABASE');
    expect(stagesReported).toContain('FINALIZING');
  });

  it('13. FinanceRepository.assessBulkContributions prevents duplicate student obligations for same rule and semester', async () => {
    let capturedObligations: any[] = [];

    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'student_enrollments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'stu-uuid-1' },
                { student_id: 'stu-uuid-2' },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [
                  { id: 'stu-uuid-1' },
                  { id: 'stu-uuid-2' },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_obligations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockResolvedValue({
                  // stu-uuid-1 already has this obligation
                  data: [{ student_id: 'stu-uuid-1' }],
                  error: null,
                }),
              }),
            }),
          }),
          insert: vi.fn().mockImplementation((rows: any[]) => {
            capturedObligations.push(...rows);
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    const { FinanceRepository } = await import('@/database/repositories/finance.repository');
    const result = await FinanceRepository.assessBulkContributions({
      semesterId: 'sem-uuid-1',
      ruleId: 'rule-uuid-1',
      title: 'CSG Membership Fee',
      amountCentavos: 15000,
      dueDate: '2026-12-15',
      targetScope: 'ALL',
      actorUserId: '00000000-0000-0000-0000-000000000001',
    });

    // Only stu-uuid-2 is newly assigned
    expect(result.totalAssigned).toBe(1);
    expect(result.totalCentavos).toBe(15000);
    expect(capturedObligations).toHaveLength(1);
    expect(capturedObligations[0].student_id).toBe('stu-uuid-2');
  });

  it('14. FinanceService.createContributionCollection on retry with existingRuleId skips rule creation and assigns obligations', async () => {
    let ruleInserted = false;
    let obligationsInserted = 0;

    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'obligation_rules') {
        return {
          insert: vi.fn().mockImplementation(() => {
            ruleInserted = true;
            return Promise.resolve({ error: null });
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'rule-uuid-existing',
                  semester_id: 'sem-uuid-1',
                  name: 'College T-Shirt Fee',
                  type: 'CONTRIBUTION',
                  default_amount_centavos: 25000,
                  status: 'ACTIVE',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_enrollments') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'stu-uuid-1' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'students') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ id: 'stu-uuid-1' }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'student_obligations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockResolvedValue({
                  data: [],
                  error: null,
                }),
              }),
            }),
          }),
          insert: vi.fn().mockImplementation((rows: any[]) => {
            obligationsInserted += rows.length;
            return Promise.resolve({ error: null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue(createMockBuilder({ data: [], error: null })),
      };
    });

    const { OperationPolicyService } = await import('@/services/operation-policy.service');
    OperationPolicyService.setMockOfflineOverride(false);

    const { financeService } = await import('@/services/finance.service');
    const result = await financeService.createContributionCollection({
      name: 'College T-Shirt Fee',
      amountCentavos: 25000,
      semesterId: 'sem-uuid-1',
      targetScope: 'ALL',
      existingRuleId: 'rule-uuid-existing',
    });

    // Rule creation was skipped on retry
    expect(ruleInserted).toBe(false);
    expect(result.rule.id).toBe('rule-uuid-existing');
    expect(result.assessResult.totalAssigned).toBe(1);
    expect(obligationsInserted).toBe(1);
  });

  it('15. Direct Supabase getObligationsBySemester maps student name, School ID, program, year level, and section', async () => {
    const { DataModeService } = await import('@/services/data-mode.service');
    DataModeService.setMode('supabase_direct');

    const { supabase } = await import('@/integrations/supabase/client');

    supabase.from = vi.fn().mockImplementation((table: string): any => {
      if (table === 'student_obligations') {
        return createChainableMock({
          data: [
            {
              id: 'ob-uuid-1',
              student_id: 'stu-academic-1',
              semester_id: 'sem-uuid-1',
              rule_id: 'rule-uuid-1',
              title: 'Midterm Fee',
              type: 'CONTRIBUTION',
              amount_centavos: 10000,
              status: 'ACTIVE',
              due_date: '2026-11-30',
              issued_at: '2026-11-08T00:00:00Z',
              updated_at: '2026-11-08T00:00:00Z',
            },
          ],
          error: null,
        });
      }
      if (table === 'payment_allocations') {
        return createChainableMock({ data: [], error: null });
      }
      if (table === 'students') {
        return createChainableMock({
          data: [
            {
              id: 'stu-academic-1',
              school_id: 'MCC-2024-0012',
              first_name: 'Juan',
              last_name: 'Dela Cruz',
              status: 'ACTIVE',
            },
          ],
          error: null,
        });
      }
      if (table === 'student_enrollments') {
        return createChainableMock({
          data: [
            {
              id: 'enr-1',
              student_id: 'stu-academic-1',
              program_id: 'prog-bsit',
              year_level: 3,
              section: '3A',
              enrollment_status: 'ENROLLED',
            },
          ],
          error: null,
        });
      }
      if (table === 'programs') {
        return createChainableMock({
          data: [
            { id: 'prog-bsit', code: 'BSIT', name: 'Bachelor of Science in Information Technology' },
          ],
          error: null,
        });
      }
      if (table === 'nfc_cards') {
        return createChainableMock({ data: [], error: null });
      }
      return createChainableMock({ data: [], error: null });
    });

    const { studentService } = await import('@/services/student.service');
    studentService.clearCache();

    const { financeService } = await import('@/services/finance.service');
    const obligations = await financeService.getObligationsBySemester('sem-uuid-1', 'CONTRIBUTION');

    expect(obligations).toHaveLength(1);
    const ob = obligations[0];
    expect(ob.studentName).toBe('Dela Cruz, Juan');
    expect(ob.schoolId).toBe('MCC-2024-0012');
    expect(ob.yearLevel).toBe(3);
    expect(ob.section).toBe('3A');
    expect(ob.course).toBe('BSIT');
    expect(ob.program).toBe('BSIT');
  });

  it('16. useCurrentStudentPortal resolves student_id from public.users and loads profile via studentService', async () => {
    const { DataModeService } = await import('@/services/data-mode.service');
    DataModeService.setMode('supabase_direct');

    const { supabase } = await import('@/integrations/supabase/client');

    supabase.auth.getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-student-42',
          email: 'student42@mcc.edu.ph',
        } as any,
      },
      error: null,
    });

    supabase.from = vi.fn().mockImplementation((table: string): any => {
      if (table === 'users') {
        return createChainableMock({
          data: {
            id: 'auth-user-student-42',
            student_id: 'stu-uuid-42',
            username: 'MCC-2024-0042',
          },
          error: null,
        });
      }
      if (table === 'students') {
        return createChainableMock({
          data: {
            id: 'stu-uuid-42',
            school_id: 'MCC-2024-0042',
            first_name: 'Alex',
            last_name: 'Reyes',
            status: 'ACTIVE',
          },
          error: null,
        });
      }
      if (table === 'student_enrollments') {
        return createChainableMock({
          data: [
            {
              id: 'enr-42',
              student_id: 'stu-uuid-42',
              program_id: 'prog-bsit',
              year_level: 2,
              section: '2A',
              enrollment_status: 'ENROLLED',
            },
          ],
          error: null,
        });
      }
      if (table === 'programs') {
        return createChainableMock({
          data: [
            { id: 'prog-bsit', code: 'BSIT', name: 'Information Technology' },
          ],
          error: null,
        });
      }
      if (table === 'nfc_cards') {
        return createChainableMock({
          data: [
            {
              id: 'card-42',
              student_id: 'stu-uuid-42',
              uid_normalized: '04:12:34:AB:CD',
              status: 'ACTIVE',
            },
          ],
          error: null,
        });
      }
      return createChainableMock({ data: [], error: null });
    });

    const { studentService } = await import('@/services/student.service');
    studentService.clearCache();

    const { useCurrentStudentPortal } = await import('@/composables/useCurrentStudentPortal');
    const { resolveCurrentStudent, student, studentName, academicSummary, error } = useCurrentStudentPortal();

    const resolved = await resolveCurrentStudent();

    expect(resolved).not.toBeNull();
    expect(student.value?.id).toBe('stu-uuid-42');
    expect(student.value?.studentNumber).toBe('MCC-2024-0042');
    expect(studentName.value).toBe('Alex Reyes');
    expect(student.value?.yearLevel).toBe(2);
    expect(student.value?.section).toBe('2A');
    expect(student.value?.course).toBe('BSIT');
    expect(student.value?.rfidUid).toBe('04:12:34:AB:CD');
    expect(academicSummary.value).toBe('BSIT • 2nd Year • Section 2A');
    expect(error.value).toBeNull();
  });

  it('17. Direct Supabase DELETE operations execute remote delete queries', async () => {
    const { DataModeService } = await import('@/services/data-mode.service');
    DataModeService.setMode('supabase_direct');

    const { supabase } = await import('@/integrations/supabase/client');
    const deletedTables: string[] = [];

    supabase.from = vi.fn().mockImplementation((table: string): any => {
      const defaultBuilder = createChainableMock({ data: [], error: null });
      if (table === 'students') {
        return {
          ...defaultBuilder,
          select: vi.fn().mockReturnValue(createChainableMock({
            data: { id: 'stu-del-1', school_id: 'MCC-001', first_name: 'Test', last_name: 'Student', status: 'ACTIVE' },
            error: null,
          })),
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              deletedTables.push(`${table}:${col}=${val}`);
              return Promise.resolve({ error: null });
            }),
          }),
        };
      }
      return {
        ...defaultBuilder,
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((col: string, val: string) => {
            deletedTables.push(`${table}:${col}=${val}`);
            return Promise.resolve({ error: null });
          }),
        }),
      };
    });

    const { studentService } = await import('@/services/student.service');
    await studentService.deleteStudent('stu-del-1');
    expect(deletedTables).toContain('students:id=stu-del-1');

    await studentService.deleteNfcCard('card-del-1');
    expect(deletedTables).toContain('nfc_cards:id=card-del-1');

    const { eventService } = await import('@/services/event.service');
    await eventService.deleteEvent('evt_33333333-3333-3333-3333-333333333333');
    expect(deletedTables).toContain('events:id=33333333-3333-3333-3333-333333333333');

    const { financeService } = await import('@/services/finance.service');
    await financeService.deleteObligationRule('rule-del-1');
    expect(deletedTables).toContain('obligation_rules:id=rule-del-1');

    const { OfficerManagementService } = await import('@/services/officer-management.service');
    await OfficerManagementService.deleteOfficer('appt-del-1');
    expect(deletedTables).toContain('officer_appointments:id=appt-del-1');
  });

  it('18. useAuth composable correctly identifies isDevAdmin and isOfficer', async () => {
    const { useAuth } = await import('@/composables/useAuth');
    const { SupabaseAuthService } = await import('@/integrations/supabase/auth.service');
    const { authService } = await import('@/services/auth.service');

    (SupabaseAuthService as any).currentRole.value = 'DEVADMIN';
    const { isDevAdmin, isOfficer } = useAuth();

    expect(isDevAdmin.value).toBe(true);
    expect(isOfficer.value).toBe(false);

    (SupabaseAuthService as any).currentRole.value = 'OFFICER';
    expect(isDevAdmin.value).toBe(false);
    expect(isOfficer.value).toBe(true);

    (SupabaseAuthService as any).currentRole.value = 'STUDENT';
    expect(isDevAdmin.value).toBe(false);
    expect(isOfficer.value).toBe(false);
  });

  it('19. useCurrentStudentPortal resolves student via user_metadata.school_id when student_id is null and repairs the link', async () => {
    const { DataModeService } = await import('@/services/data-mode.service');
    DataModeService.setMode('supabase_direct');

    const { supabase } = await import('@/integrations/supabase/client');
    const { authService } = await import('@/services/auth.service');
    const { SupabaseAuthService } = await import('@/integrations/supabase/auth.service');

    (authService as any).student.value = null;
    (authService as any).user.value = null;
    (SupabaseAuthService as any).user.value = null;

    supabase.auth.getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'auth-uuid-999',
          email: 'student999@mcc.edu.ph',
          user_metadata: {
            school_id: 'MCC-2024-0999',
          },
        } as any,
      },
      error: null,
    });

    let repairedPayload: any = null;
    let repairedTargetUid: string | null = null;

    supabase.from = vi.fn().mockImplementation((table: string): any => {
      if (table === 'users') {
        const builder = createChainableMock({
          data: {
            id: 'auth-uuid-999',
            student_id: null,
            username: 'student999@mcc.edu.ph',
          },
          error: null,
        });
        builder.update = vi.fn().mockImplementation((payload: any) => {
          repairedPayload = payload;
          return {
            eq: vi.fn().mockImplementation((col: string, val: string) => {
              if (col === 'id') repairedTargetUid = val;
              return Promise.resolve({ data: null, error: null });
            }),
          };
        });
        return builder;
      }
      if (table === 'students') {
        return createChainableMock({
          data: {
            id: 'stu-uuid-999',
            school_id: 'MCC-2024-0999',
            first_name: 'Maria',
            last_name: 'Santos',
            status: 'ACTIVE',
          },
          error: null,
        });
      }
      if (table === 'student_enrollments') {
        return createChainableMock({
          data: [
            {
              id: 'enr-999',
              student_id: 'stu-uuid-999',
              program_id: 'prog-bscs',
              year_level: 3,
              section: '3B',
              enrollment_status: 'ENROLLED',
            },
          ],
          error: null,
        });
      }
      if (table === 'programs') {
        return createChainableMock({
          data: [
            { id: 'prog-bscs', code: 'BSCS', name: 'Computer Science' },
          ],
          error: null,
        });
      }
      if (table === 'nfc_cards') {
        return createChainableMock({
          data: [],
          error: null,
        });
      }
      return createChainableMock({ data: [], error: null });
    });

    const { studentService } = await import('@/services/student.service');
    studentService.clearCache();

    const { useCurrentStudentPortal } = await import('@/composables/useCurrentStudentPortal');
    const { resolveCurrentStudent, student, studentName, academicSummary, error } = useCurrentStudentPortal();

    const resolved = await resolveCurrentStudent();

    expect(resolved).not.toBeNull();
    expect(student.value?.id).toBe('stu-uuid-999');
    expect(student.value?.studentNumber).toBe('MCC-2024-0999');
    expect(studentName.value).toBe('Maria Santos');
    expect(student.value?.course).toBe('BSCS');
    expect(academicSummary.value).toBe('BSCS • 3rd Year • Section 3B');
    expect(error.value).toBeNull();

    // Verify repair payload used student UUID, not auth UUID
    expect(repairedPayload).toEqual({ student_id: 'stu-uuid-999' });
    expect(repairedTargetUid).toBe('auth-uuid-999');
  });

  it('20. useCurrentStudentPortal never uses email username as School ID or auth UUID for student UUID', async () => {
    const { DataModeService } = await import('@/services/data-mode.service');
    DataModeService.setMode('supabase_direct');

    const { supabase } = await import('@/integrations/supabase/client');
    const { authService } = await import('@/services/auth.service');
    const { SupabaseAuthService } = await import('@/integrations/supabase/auth.service');

    (authService as any).student.value = null;
    (authService as any).user.value = null;
    (SupabaseAuthService as any).user.value = null;

    // Authenticated user with email but NO school_id in user_metadata
    supabase.auth.getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: 'auth-uuid-unlinked',
          email: 'unlinked.student@mcc.edu.ph',
          user_metadata: {},
        } as any,
      },
      error: null,
    });

    let queriedStudentsBySchoolId: string[] = [];

    supabase.from = vi.fn().mockImplementation((table: string): any => {
      if (table === 'users') {
        return createChainableMock({
          data: {
            id: 'auth-uuid-unlinked',
            student_id: null,
            username: 'unlinked.student',
          },
          error: null,
        });
      }
      if (table === 'students') {
        const builder = createChainableMock({ data: null, error: null });
        builder.eq = vi.fn().mockImplementation((col: string, val: string) => {
          if (col === 'school_id') queriedStudentsBySchoolId.push(val);
          return builder;
        });
        return builder;
      }
      return createChainableMock({ data: [], error: null });
    });

    const { studentService } = await import('@/services/student.service');
    studentService.clearCache();

    const { useCurrentStudentPortal } = await import('@/composables/useCurrentStudentPortal');
    const { resolveCurrentStudent, student, error } = useCurrentStudentPortal();

    const resolved = await resolveCurrentStudent();

    // Must NOT resolve to student, and must NOT search by email username 'unlinked.student'
    expect(resolved).toBeNull();
    expect(student.value).toBeNull();
    expect(queriedStudentsBySchoolId).not.toContain('unlinked.student');
    expect(error.value).toBe('No student profile is linked to this authenticated account. Please contact an officer to link your student record.');
  });

  it('21. AttendanceService supports multiple checkpoints per occurrence and tracks duplicates per checkpoint', async () => {
    const { DataModeService } = await import('@/services/data-mode.service');
    DataModeService.setMode('supabase_direct');

    const { supabase } = await import('@/integrations/supabase/client');
    const { attendanceService } = await import('@/services/attendance.service');

    const mockOccurrence = {
      id: 'occ-uuid-checkpoint-test',
      status: 'OPEN',
      checkpoints_json: JSON.stringify([
        { id: 'cp_in_morning', label: 'Morning IN', type: 'IN', orderIndex: 0 },
        { id: 'cp_out_morning', label: 'Morning OUT', type: 'OUT', orderIndex: 1 },
      ]),
      active_checkpoint_id: 'cp_in_morning',
    };

    const mockCard = {
      uid_normalized: '04AABBCCDDEEFF',
      student_id: 'stu-uuid-checkpoint',
      status: 'ACTIVE',
    };

    const mockStudent = {
      id: 'stu-uuid-checkpoint',
      firstName: 'Juan',
      lastName: 'Dela Cruz',
      status: 'ACTIVE',
      studentNumber: '2026-0001',
      photoStoragePath: 'students/stu-uuid-checkpoint.jpg',
    };

    // State of attendance records in this test
    const recordedRecords: any[] = [];

    supabase.from = vi.fn().mockImplementation((table: string): any => {
      if (table === 'event_occurrences') {
        return createChainableMock({ data: mockOccurrence, error: null });
      }
      if (table === 'nfc_cards') {
        return createChainableMock({ data: [mockCard], error: null });
      }
      if (table === 'students') {
        return createChainableMock({ data: mockStudent, error: null });
      }
      if (table === 'attendance_records') {
        const builder = createChainableMock({ data: null, error: null });
        let qOccurrenceId = '';
        let qStudentId = '';
        let qCheckpointId = '';

        builder.eq = vi.fn().mockImplementation((col: string, val: string) => {
          if (col === 'occurrence_id') qOccurrenceId = val;
          if (col === 'student_id') qStudentId = val;
          if (col === 'checkpoint_id') qCheckpointId = val;
          return builder;
        });

        builder.maybeSingle = vi.fn().mockImplementation(() => {
          const found = recordedRecords.find(
            r => r.occurrence_id === qOccurrenceId &&
                 r.student_id === qStudentId &&
                 r.checkpoint_id === qCheckpointId
          );
          return Promise.resolve({ data: found || null, error: null });
        });

        return builder;
      }
      return createChainableMock({ data: [], error: null });
    });

    const { studentService } = await import('@/services/student.service');
    vi.spyOn(studentService, 'getStudent').mockResolvedValue(mockStudent as any);

    // 1. First scan for Morning IN -> Should be ACCEPTED
    const scan1 = await attendanceService.prepareNfcVerification(
      'occ-uuid-checkpoint-test',
      '04AABBCCDDEEFF',
      'officer-1',
      'cp_in_morning'
    );
    expect(scan1.type).toBe('ACCEPTED');
    expect(scan1.checkpointId).toBe('cp_in_morning');
    expect(scan1.checkpointLabel).toBe('Morning IN');

    // Simulate saving attendance for Morning IN
    recordedRecords.push({
      id: 'att-1',
      occurrence_id: 'occ-uuid-checkpoint-test',
      student_id: 'stu-uuid-checkpoint',
      checkpoint_id: 'cp_in_morning',
      status: 'PRESENT',
    });

    // 2. Second scan for Morning IN -> Should be detected as DUPLICATE
    const scan2 = await attendanceService.prepareNfcVerification(
      'occ-uuid-checkpoint-test',
      '04AABBCCDDEEFF',
      'officer-1',
      'cp_in_morning'
    );
    expect(scan2.type).toBe('DUPLICATE');
    expect(scan2.message).toContain('already recorded as PRESENT');

    // 3. Scan for Morning OUT (different checkpoint) -> Should be ACCEPTED!
    const scan3 = await attendanceService.prepareNfcVerification(
      'occ-uuid-checkpoint-test',
      '04AABBCCDDEEFF',
      'officer-1',
      'cp_out_morning'
    );
    expect(scan3.type).toBe('ACCEPTED');
    expect(scan3.checkpointId).toBe('cp_out_morning');
    expect(scan3.checkpointLabel).toBe('Morning OUT');
  });

  it('22. StudentService resolves and caches student profile photos via Supabase Storage', async () => {
    const { studentService } = await import('@/services/student.service');
    studentService.clearPhotoUrlCache();

    const studentWithPhoto = {
      id: 'stu-photo-1',
      photoStoragePath: 'students/stu-photo-1.jpg',
    } as any;

    const url1 = studentService.getStudentPhotoUrl(studentWithPhoto);
    expect(url1).toBeTruthy();
    expect(url1).toContain('student-profile-photos/students/stu-photo-1.jpg');

    // Should return cached URL on second call
    const url2 = studentService.getStudentPhotoUrl(studentWithPhoto);
    expect(url2).toBe(url1);

    // Handles null / empty storage path gracefully
    expect(studentService.getStudentPhotoUrl({ id: 'stu-no-photo' } as any)).toBeNull();
    expect(studentService.getStudentPhotoUrl(null)).toBeNull();
  });

  it('23. FinanceRepository and FinanceService filter eligible students with outstanding balances in Direct Supabase mode', async () => {
    const { FinanceRepository } = await import('@/database/repositories/finance.repository');
    const { financeService } = await import('@/services/finance.service');

    // Mock student_obligations table:
    // stu-1: has balance 10000 on rule-contrib-1 (CONTRIBUTION)
    // stu-2: has balance 5000 on rule-fine-1 (FINE)
    // stu-3: has balance 0 (fully paid) on rule-contrib-1
    // stu-4: has obligation marked VOID
    const mockObligations = [
      { id: 'ob-1', student_id: 'stu-1', rule_id: 'rule-contrib-1', type: 'CONTRIBUTION', semester_id: 'sem-1', amount_centavos: 10000, status: 'UNPAID' },
      { id: 'ob-2', student_id: 'stu-2', rule_id: 'rule-fine-1', type: 'FINE', semester_id: 'sem-1', amount_centavos: 5000, status: 'UNPAID' },
      { id: 'ob-3', student_id: 'stu-3', rule_id: 'rule-contrib-1', type: 'CONTRIBUTION', semester_id: 'sem-1', amount_centavos: 10000, status: 'PAID' },
      { id: 'ob-4', student_id: 'stu-4', rule_id: 'rule-contrib-1', type: 'CONTRIBUTION', semester_id: 'sem-1', amount_centavos: 10000, status: 'VOID' },
    ];

    // Mock payment_allocations:
    // ob-3 has 10000 paid (settled)
    // ob-1 has 2000 paid (partially paid, balance = 8000 > 0)
    const mockAllocations = [
      { obligation_id: 'ob-3', amount_centavos: 10000, payment_id: 'pay-3' },
      { obligation_id: 'ob-1', amount_centavos: 2000, payment_id: 'pay-1' },
    ];
    const mockPayments = [
      { id: 'pay-3', status: 'POSTED' },
      { id: 'pay-1', status: 'POSTED' },
    ];

    supabase.from = vi.fn().mockImplementation((table: string) => {
      if (table === 'student_obligations') {
        let currentFilter = [...mockObligations];
        const handler: any = {
          select: vi.fn().mockImplementation(() => handler),
          neq: vi.fn().mockImplementation((col: string, val: any) => {
            currentFilter = currentFilter.filter((o: any) => o[col] !== val);
            return handler;
          }),
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            currentFilter = currentFilter.filter((o: any) => o[col] === val);
            return handler;
          }),
          then: (resolve: any) => resolve({ data: currentFilter, error: null }),
        };
        return handler;
      }
      if (table === 'payment_allocations') {
        let currentAllocs = [...mockAllocations];
        const handler: any = {
          select: vi.fn().mockImplementation(() => handler),
          in: vi.fn().mockImplementation((col: string, ids: string[]) => {
            currentAllocs = currentAllocs.filter((a: any) => ids.includes(a[col]));
            return handler;
          }),
          then: (resolve: any) => resolve({ data: currentAllocs, error: null }),
        };
        return handler;
      }
      if (table === 'payments') {
        let currentPays = [...mockPayments];
        const handler: any = {
          select: vi.fn().mockImplementation(() => handler),
          in: vi.fn().mockImplementation((col: string, ids: string[]) => {
            currentPays = currentPays.filter((p: any) => ids.includes(p[col]));
            return handler;
          }),
          eq: vi.fn().mockImplementation((col: string, val: any) => {
            currentPays = currentPays.filter((p: any) => p[col] === val);
            return handler;
          }),
          then: (resolve: any) => resolve({ data: currentPays, error: null }),
        };
        return handler;
      }
      if (table === 'students') {
        const createStudentResult = (ids: string[]) => ({
          data: ids.map((id) => ({
            id,
            school_id: '2026-' + id,
            first_name: 'Student',
            last_name: id.toUpperCase(),
            rfid_card_id: null,
            is_active: true,
          })),
          error: null,
        });

        const handler: any = {
          in: vi.fn().mockImplementation((col: string, ids: string[]) => {
            const promise = Promise.resolve(createStudentResult(ids));
            (promise as any).order = vi.fn().mockReturnValue(Promise.resolve(createStudentResult(ids)));
            return promise;
          }),
        };

        return {
          select: vi.fn().mockReturnValue(handler),
        };
      }
      if (table === 'student_enrollments') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'nfc_cards') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return createChainableMock({ data: [], error: null });
    });

    // 1. All Obligations: returns stu-1 and stu-2 (stu-3 is fully paid, stu-4 is VOID)
    const allIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({ semesterId: 'sem-1' });
    expect(allIds).toContain('stu-1');
    expect(allIds).toContain('stu-2');
    expect(allIds).not.toContain('stu-3');
    expect(allIds).not.toContain('stu-4');

    // 2. Category: CONTRIBUTION: returns only stu-1
    const contribIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
      category: 'CONTRIBUTION',
      semesterId: 'sem-1',
    });
    expect(contribIds).toEqual(['stu-1']);

    // 3. Category: FINE: returns only stu-2
    const fineIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
      category: 'FINE',
      semesterId: 'sem-1',
    });
    expect(fineIds).toEqual(['stu-2']);

    // 4. Specific template: rule-contrib-1
    const ruleIds = await FinanceRepository.getStudentIdsWithOutstandingBalance({
      ruleId: 'rule-contrib-1',
      semesterId: 'sem-1',
    });
    expect(ruleIds).toEqual(['stu-1']);

    // 5. financeService.getEligibleStudentsForPayment returns populated Student objects
    const eligibleStudents = await financeService.getEligibleStudentsForPayment({
      category: 'CONTRIBUTION',
      semesterId: 'sem-1',
    });
    expect(eligibleStudents.length).toBe(1);
    expect(eligibleStudents[0].id).toBe('stu-1');
  });
});
