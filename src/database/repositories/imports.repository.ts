import { getDatabase } from '../database';
import type { DatabaseAdapter } from '../adapters/database-adapter.interface';
import type { ImportBatchRecord, ImportRowRecord } from '../../types/database';

export class ImportsRepository {
  private static async getDb(adapter?: DatabaseAdapter): Promise<DatabaseAdapter> {
    return adapter || getDatabase();
  }

  public static async createBatch(batch: ImportBatchRecord, adapter?: DatabaseAdapter): Promise<void> {
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
    const db = await this.getDb(adapter);
    await db.execute(
      `UPDATE import_batches
       SET status = ?, total_rows = ?, imported_rows = ?, rejected_rows = ?
       WHERE id = ?`,
      [status, totalRows, importedRows, rejectedRows, batchId]
    );
  }

  public static async getBatchesBySemester(semesterId: string, adapter?: DatabaseAdapter): Promise<ImportBatchRecord[]> {
    const db = await this.getDb(adapter);
    return db.query<ImportBatchRecord>(
      'SELECT * FROM import_batches WHERE semester_id = ? ORDER BY imported_at DESC',
      [semesterId]
    );
  }

  public static async getBatchRows(batchId: string, adapter?: DatabaseAdapter): Promise<ImportRowRecord[]> {
    const db = await this.getDb(adapter);
    return db.query<ImportRowRecord>(
      'SELECT * FROM import_rows WHERE batch_id = ? ORDER BY row_number ASC',
      [batchId]
    );
  }
}

