import { getDb } from "../db";
import type { Bin } from "../types";

export interface StaleBin extends Bin {
  last_activity: string | null;
}

export function listStaleBins(days: number): StaleBin[] {
  const cutoff = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const rows = getDb()
    .prepare(
      `SELECT b.*, MAX(vn.modified_at) AS last_activity
       FROM bins b
       LEFT JOIN note_bins nb ON nb.bin_id = b.id
       LEFT JOIN vault_notes vn ON vn.id = nb.note_id AND vn.deleted_at IS NULL
       GROUP BY b.id
       HAVING last_activity IS NULL OR last_activity < ?
       ORDER BY (last_activity IS NULL) DESC, last_activity ASC`
    )
    .all(cutoff) as StaleBin[];
  return rows;
}
