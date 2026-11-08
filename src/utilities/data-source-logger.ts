import { DataModeService } from '@/services/data-mode.service';

export interface DataSourceLogInfo {
  page?: string;
  source: 'Supabase' | 'SQLite';
  operation: string;
  result?: string | number;
}

/**
 * Development-only diagnostic logging utility to identify authoritative data sources
 * across application pages, composables, and services.
 * Strictly sanitizes output: never logs tokens, passwords, or personal data.
 */
export function logDataSource(info: DataSourceLogInfo): void {
  try {
    const isDev = import.meta.env?.DEV || import.meta.env?.MODE === 'development';
    if (!isDev) return;

    const page = info.page || 'UniTap';
    const mode = DataModeService.isDirectSupabase() ? 'supabase_direct' : 'offline_first';
    const resultText = info.result !== undefined ? `${info.result} records` : 'OK';

    console.log(
      `[DATA SOURCE]\nPage: ${page}\nMode: ${mode}\nSource: ${info.source}\nOperation: ${info.operation}\nResult: ${resultText}`
    );
  } catch {
    // Non-fatal
  }
}

