import { getDb } from "../db";
import { nowIso } from "../utils";
import type { SyncStatusRecord, SyncStatus } from "../types";

export function recordSyncRun(input: {
  sync_name: string;
  status: SyncStatus;
  error_message?: string | null;
  duration_ms?: number | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_status (sync_name, last_run_at, status, error_message, duration_ms)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sync_name) DO UPDATE SET
       last_run_at = excluded.last_run_at,
       status = excluded.status,
       error_message = excluded.error_message,
       duration_ms = excluded.duration_ms`
  ).run(input.sync_name, nowIso(), input.status, input.error_message ?? null, input.duration_ms ?? null);
}

export function listSyncStatuses(): SyncStatusRecord[] {
  const db = getDb();
  return db.prepare("SELECT * FROM sync_status ORDER BY sync_name ASC").all() as SyncStatusRecord[];
}
