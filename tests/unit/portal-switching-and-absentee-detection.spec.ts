import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfficerManagementService } from '@/services/officer-management.service';
import { SupabaseAuthService } from '@/integrations/supabase/auth.service';
import { DataModeService } from '@/services/data-mode.service';

describe('Portal Switching & Officer Appointment Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('orders officer appointment queries by appointment_start instead of created_at', async () => {
    vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(true);

    const orderSpy = vi.fn().mockReturnThis();
    const limitSpy = vi.fn().mockReturnThis();
    const maybeSingleSpy = vi.fn().mockResolvedValue({
      data: {
        id: 'appt-althea-uuid',
        status: 'ACTIVE',
        appointment_start: new Date(Date.now() - 3600000).toISOString(),
        appointment_end: new Date(Date.now() + 3600000).toISOString(),
        revoked_at: null,
      },
      error: null,
    });

    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: orderSpy,
      limit: limitSpy,
      maybeSingle: maybeSingleSpy,
    };

    const { supabase } = await import('@/integrations/supabase/client');
    vi.spyOn(supabase, 'from').mockReturnValue(queryMock as any);

    const isValid = await OfficerManagementService.hasValidOfficerAppointment(
      '2c870f93-4387-4aca-8c87-a2480c9a2a89',
      '522717fc-100c-43f5-ba69-c6f0a6af1996'
    );

    expect(isValid).toBe(true);
    // Verified: appointment_start is used for ordering, NOT non-existent created_at
    expect(orderSpy).toHaveBeenCalledWith('appointment_start', { ascending: false });
    expect(orderSpy).not.toHaveBeenCalledWith('created_at', expect.anything());
  });

  it('returns false if appointment has ended or is not active', async () => {
    vi.spyOn(DataModeService, 'isDirectSupabase').mockReturnValue(true);

    const pastDate = new Date(Date.now() - 100000).toISOString();
    const queryMock = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'appt-expired',
          status: 'ACTIVE',
          appointment_start: new Date(Date.now() - 200000).toISOString(),
          appointment_end: pastDate,
          revoked_at: null,
        },
        error: null,
      }),
    };

    const { supabase } = await import('@/integrations/supabase/client');
    vi.spyOn(supabase, 'from').mockReturnValue(queryMock as any);

    const isValid = await OfficerManagementService.hasValidOfficerAppointment(
      'user-expired',
      'student-expired'
    );

    expect(isValid).toBe(false);
  });
});

