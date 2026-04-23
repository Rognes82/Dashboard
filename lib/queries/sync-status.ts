import { getDb } from "../db";
import { nowIso } from "../utils";
import type { SyncStatusRecord, SyncStatus } from "../types";

export function recordSyncRun(input: {
  sync_name: string;
  status: SyncStatus;
  error_message?: string | null;
  duration_ms?: number | null;
  cursor?: string | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO sync_status (sync_name, last_run_at, status, error_message, duration_ms, cursor)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sync_name) DO UPDATE SET
       last_run_at = excluded.last_run_at,
       status = excluded.status,
       error_message = excluded.error_message,
       duration_ms = excluded.duration_ms,
       cursor = COALESCE(excluded.cursor, sync_status.cursor)`
  ).run(
    input.sync_name,
    nowIso(),
    input.status,
    input.error_message ?? null,
    input.duration_ms ?? null,
    input.cursor ?? null
  );
}

export function readSyncCursor(sync_name: string): string | null {
  const row = getDb()
    .prepare("SELECT cursor FROM sync_status WHERE sync_name = ?")
    .get(sync_name) as { cursor: string | null } | undefined;
  return row?.cursor ?? null;
}

export function listSyncStatuses(): SyncStatusRecord[] {
  return getDb().prepare("SELECT * FROM sync_status ORDER BY sync_name ASC").all() as SyncStatusRecord[];
}
