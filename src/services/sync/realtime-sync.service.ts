import { supabase } from '@/integrations/supabase/client';
import { SyncManager } from './sync-manager';
import type { RealtimeChannel } from '@supabase/supabase-js';

export class RealtimeSyncService {
  private static channel: RealtimeChannel | null = null;
  private static isSubscribed = false;

  public static subscribe(): void {
    if (this.isSubscribed || this.channel) return;

    this.channel = supabase
      .channel('unitap-live-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'attendance_records' },
        (payload) => {
          console.log('[Realtime] Attendance change detected:', payload);
          SyncManager.triggerRealtimeSync();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments' },
        (payload) => {
          console.log('[Realtime] Payment change detected:', payload);
          SyncManager.triggerRealtimeSync();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'student_obligations' },
        (payload) => {
          console.log('[Realtime] Obligation change detected:', payload);
          SyncManager.triggerRealtimeSync();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] Connected to live sync channel.');
          this.isSubscribed = true;
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          this.isSubscribed = false;
        }
      });
  }

  public static unsubscribe(): void {
    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
      this.isSubscribed = false;
    }
  }
}
