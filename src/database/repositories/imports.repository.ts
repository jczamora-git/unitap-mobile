import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { ImportBatchRecord, ImportRowRecord } from '../../types/database';
import { supabase } from '@/integrations/supabase/client';
import { DataModeService } from '@/services/data-mode.service';

export class ImportsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async createBatch(batch: ImportBatchRecord, adapter?: DatabaseAdapter): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('import_batches').upsert([{
        id: batch.id,
        semester_id: batch.semester_id,
        source_filename: batch.source_filename,
        sha256: batch.sha256,
        imported_by_user_id: batch.imported_by_user_id?.startsWith('usr_') ? null : batch.imported_by_user_id,
        imported_at: batch.imported_at,
        status: batch.status,
        total_rows: batch.total_rows,
        imported_rows: batch.imported_rows,
        rejected_rows: batch.rejected_rows,
      }]);
      if (error) {
        console.warn('[ImportsRepository] Direct Supabase createBatch warning:', error.message);
      }
      return;
    }
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO import_batches (
        id, semester_id, source_filename, sha256, imported_by_user_id,
        imported_at, status, total_rows, imported_rows, rejected_rows
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batch.id,
        batch.semester_id,
        batch.source_filename,
        batch.sha256,
        batch.imported_by_user_id,
        batch.imported_at,
        batch.status,
        batch.total_rows,
        batch.imported_rows,
        batch.rejected_rows,
      ]
    );
  }

  public static async recordRow(row: ImportRowRecord, adapter?: DatabaseAdapter): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let rawObj: any;
      try {
        rawObj = typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : row.raw_json;
      } catch {
        rawObj = { raw: row.raw_json };
      }
      const { error } = await supabase.from('import_rows').insert([{
        id: row.id,
        batch_id: row.batch_id,
        row_number: row.row_number,
        raw_json: rawObj,
        result: row.result,
        student_id: row.student_id || null,
        error_message: row.error_message || null,
      }]);
      if (error) {
        console.warn('[ImportsRepository] Direct Supabase recordRow warning:', error.message);
      }
      return;
    }
    const db = await this.getDb(adapter);
    await db.execute(
      `INSERT INTO import_rows (id, batch_id, row_number, raw_json, result, student_id, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.batch_id,
        row.row_number,
        row.raw_json,
        row.result,
        row.student_id || null,
        row.error_message || null,
      ]
    );
  }

  public static async updateBatchSummary(
    batchId: string,
    status: ImportBatchRecord['status'],
    totalRows: number,
    importedRows: number,
    rejectedRows: number,
    adapter?: DatabaseAdapter
  ): Promise<void> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { error } = await supabase.from('import_batches').update({
        status,
        total_rows: totalRows,
        imported_rows: importedRows,
        rejected_rows: rejectedRows,
        updated_at: new Date().toISOString(),
      }).eq('id', batchId);
      if (error) {
        console.warn('[ImportsRepository] Direct Supabase updateBatchSummary warning:', error.message);
      }
      return;
    }
    const db = await this.getDb(adapter);
    await db.execute(
      `UPDATE import_batches
       SET status = ?, total_rows = ?, imported_rows = ?, rejected_rows = ?
       WHERE id = ?`,
      [status, totalRows, importedRows, rejectedRows, batchId]
    );
  }

  public static async getBatchesBySemester(semesterId: string, adapter?: DatabaseAdapter): Promise<ImportBatchRecord[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('import_batches')
        .select('*')
        .eq('semester_id', semesterId)
        .order('imported_at', { ascending: false });
      if (error) throw new Error(`Failed to query import batches from Supabase: ${error.message}`);
      return (data || []) as ImportBatchRecord[];
    }
    const db = await this.getDb(adapter);
    return db.query<ImportBatchRecord>(
      'SELECT * FROM import_batches WHERE semester_id = ? ORDER BY imported_at DESC',
      [semesterId]
    );
  }

  public static async getBatchBySha256(
    sha256: string,
    semesterId?: string,
    adapter?: DatabaseAdapter
  ): Promise<ImportBatchRecord | null> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      let q = supabase
        .from('import_batches')
        .select('*')
        .eq('sha256', sha256)
        .eq('status', 'COMPLETED')
        .order('imported_at', { ascending: false })
        .limit(1);
      if (semesterId) {
        q = q.eq('semester_id', semesterId);
      }
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(`Failed to query batch by sha256 from Supabase: ${error.message}`);
      return (data || null) as ImportBatchRecord | null;
    }
    const db = await this.getDb(adapter);
    const sql = semesterId
      ? 'SELECT * FROM import_batches WHERE sha256 = ? AND semester_id = ? AND status = "COMPLETED" ORDER BY imported_at DESC LIMIT 1'
      : 'SELECT * FROM import_batches WHERE sha256 = ? AND status = "COMPLETED" ORDER BY imported_at DESC LIMIT 1';
    const params = semesterId ? [sha256, semesterId] : [sha256];
    const rows = await db.query<ImportBatchRecord>(sql, params);
    return rows[0] || null;
  }

  public static async getBatchRows(batchId: string, adapter?: DatabaseAdapter): Promise<ImportRowRecord[]> {
    if (!adapter && DataModeService.isDirectSupabase()) {
      const { data, error } = await supabase
        .from('import_rows')
        .select('*')
        .eq('batch_id', batchId)
        .order('row_number', { ascending: true });
      if (error) throw new Error(`Failed to query import rows from Supabase: ${error.message}`);
      return (data || []) as ImportRowRecord[];
    }
    const db = await this.getDb(adapter);
    return db.query<ImportRowRecord>(
      'SELECT * FROM import_rows WHERE batch_id = ? ORDER BY row_number ASC',
      [batchId]
    );
  }
}

