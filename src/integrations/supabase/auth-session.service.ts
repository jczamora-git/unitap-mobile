import { Preferences } from '@capacitor/preferences';
import type { UserAccount, UserRoleRecord } from '@/types/database';

export interface CachedOfflineSession {
  userId: string;
  email: string;
  username: string;
  role: 'DEVADMIN' | 'OFFICER' | 'STUDENT';
  studentId?: string | null;
  cachedAt: string; // ISO
  expiresAt: string; // ISO (7 days max)
}

const CACHED_SESSION_KEY = 'unitap_cached_offline_session_v2';
const OFFLINE_MAX_DURATION_DAYS = 7;

export class AuthSessionService {
  public static async saveOfflineSession(
    user: UserAccount,
    role: UserRoleRecord,
    email: string
  ): Promise<CachedOfflineSession> {
    const now = new Date();
    const expires = new Date(now.getTime() + OFFLINE_MAX_DURATION_DAYS * 24 * 3600 * 1000);

    const session: CachedOfflineSession = {
      userId: user.id,
      email,
      username: user.username,
      role: role.role,
      studentId: user.student_id,
      cachedAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };

    await Preferences.set({
      key: CACHED_SESSION_KEY,
      value: JSON.stringify(session),
    });

    return session;
  }

  public static async getCachedOfflineSession(): Promise<CachedOfflineSession | null> {
    try {
      const { value } = await Preferences.get({ key: CACHED_SESSION_KEY });
      if (!value) return null;

      const session: CachedOfflineSession = JSON.parse(value);
      const now = new Date();
      const expires = new Date(session.expiresAt);

      if (now > expires) {
        console.warn('[AuthSession] Cached offline session expired.');
        await this.clearOfflineSession();
        return null;
      }

      return session;
    } catch {
      return null;
    }
  }

  public static async clearOfflineSession(): Promise<void> {
    await Preferences.remove({ key: CACHED_SESSION_KEY });
  }

  public static isOfflineSessionValid(session: CachedOfflineSession): boolean {
    const now = new Date();
    return new Date(session.expiresAt) > now;
  }
}
