import { getDb } from "../db";
import { newId, nowIso } from "../utils";
import type { VaultNote, VaultNoteSource, VaultNoteSearchHit } from "../types";

export interface UpsertVaultNoteInput {
  vault_path: string;
  title: string;
  source: VaultNoteSource;
  source_id: string | null;
  source_url: string | null;
  content_hash: string;
  modified_at: string;
  created_at?: string;
  client_id?: string | null;
  project_id?: string | null;
}

export function upsertVaultNote(input: UpsertVaultNoteInput): VaultNote {
  const db = getDb();
  const tx = db.transaction((): VaultNote => {
    const now = nowIso();
    const existingBySourceId =
      input.source_id !== null ? getVaultNoteBySourceId(input.source_id) : null;
    const existingByPath = existingBySourceId ? null : getVaultNoteByPath(input.vault_path);
    const existing = existingBySourceId ?? existingByPath;

    if (existing) {
      db.prepare(
        `UPDATE vault_notes SET
           vault_path = ?, title = ?, source = ?, source_id = ?, source_url = ?,
           content_hash = ?, modified_at = ?, last_indexed_at = ?, deleted_at = NULL,
           client_id = COALESCE(?, client_id), project_id = COALESCE(?, project_id)
         WHERE id = ?`
      ).run(
        input.vault_path,
        input.title,
        input.source,
        input.source_id,
        input.source_url,
        input.content_hash,
        input.modified_at,
        now,
        input.client_id ?? null,
        input.project_id ?? null,
        existing.id
      );
      return getVaultNoteById(existing.id)!;
    }

    const id = newId();
    db.prepare(
      `INSERT INTO vault_notes (
         id, vault_path, title, source, source_id, source_url, content_hash,
         created_at, modified_at, last_indexed_at, client_id, project_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.vault_path,
      input.title,
      input.source,
      input.source_id,
      input.source_url,
      input.content_hash,
      input.created_at ?? now,
      input.modified_at,
      now,
      input.client_id ?? null,
      input.project_id ?? null
    );
    return getVaultNoteById(id)!;
  });
  return tx();
}

export function getVaultNoteById(id: string): VaultNote | null {
  const row = getDb().prepare("SELECT * FROM vault_notes WHERE id = ?").get(id) as VaultNote | undefined;
  return row ?? null;
}

export function getVaultNoteByPath(vault_path: string): VaultNote | null {
  const row = getDb()
    .prepare("SELECT * FROM vault_notes WHERE vault_path = ?")
    .get(vault_path) as VaultNote | undefined;
  return row ?? null;
}

export function getVaultNoteBySourceId(source_id: string): VaultNote | null {
  const row = getDb()
    .prepare("SELECT * FROM vault_notes WHERE source_id = ?")
    .get(source_id) as VaultNote | undefined;
  return row ?? null;
}

export function listVaultNotes(limit = 200): VaultNote[] {
  return getDb()
    .prepare(
      "SELECT * FROM vault_notes WHERE deleted_at IS NULL ORDER BY modified_at DESC LIMIT ?"
    )
    .all(limit) as VaultNote[];
}

export function listVaultNotesByClient(client_id: string, limit = 50): VaultNote[] {
  return getDb()
    .prepare(
      "SELECT * FROM vault_notes WHERE client_id = ? AND deleted_at IS NULL ORDER BY modified_at DESC LIMIT ?"
    )
    .all(client_id, limit) as VaultNote[];
}

export function listVaultNotesByBin(bin_id: string, limit = 500): VaultNote[] {
  return getDb()
    .prepare(
      `SELECT vn.* FROM vault_notes vn
       JOIN note_bins nb ON nb.note_id = vn.id
       WHERE nb.bin_id = ? AND vn.deleted_at IS NULL
       ORDER BY vn.modified_at DESC
       LIMIT ?`
    )
    .all(bin_id, limit) as VaultNote[];
}

export function listRecentVaultNotes(hours = 24, limit = 100): VaultNote[] {
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  return getDb()
    .prepare(
      "SELECT * FROM vault_notes WHERE modified_at >= ? AND deleted_at IS NULL ORDER BY modified_at DESC LIMIT ?"
    )
    .all(cutoff, limit) as VaultNote[];
}

export function listUncategorizedVaultNotes(limit = 200): VaultNote[] {
  return getDb()
    .prepare(
      `SELECT vn.* FROM vault_notes vn
       WHERE vn.deleted_at IS NULL
         AND vn.id NOT IN (SELECT note_id FROM note_bins)
       ORDER BY vn.modified_at DESC
       LIMIT ?`
    )
    .all(limit) as VaultNote[];
}

export function listAllIndexedPaths(): string[] {
  return (getDb()
    .prepare("SELECT vault_path FROM vault_notes WHERE deleted_at IS NULL")
    .all() as { vault_path: string }[]).map((r) => r.vault_path);
}

export function softDeleteVaultNote(id: string): void {
  getDb().prepare("UPDATE vault_notes SET deleted_at = ? WHERE id = ?").run(nowIso(), id);
  deleteFtsRow(id);
}

export function hardDeleteVaultNote(id: string): void {
  getDb().prepare("DELETE FROM vault_notes WHERE id = ?").run(id);
  deleteFtsRow(id);
}

export function updateFtsRow(input: { note_id: string; title: string; plain_text: string; tags: string }): void {
  const db = getDb();
  const rowid = (db.prepare("SELECT rowid FROM vault_notes WHERE id = ?").get(input.note_id) as { rowid: number } | undefined)?.rowid;
  if (rowid === undefined) {
    console.warn(`[vault-notes] updateFtsRow: no vault_notes row for id=${input.note_id}; FTS entry skipped`);
    return;
  }
  db.prepare("DELETE FROM vault_notes_fts WHERE rowid = ?").run(rowid);
  db.prepare(
    "INSERT INTO vault_notes_fts (rowid, title, content, tags) VALUES (?, ?, ?, ?)"
  ).run(rowid, input.title, input.plain_text, input.tags);
}

export function deleteFtsRow(note_id: string): void {
  const db = getDb();
  const rowid = (db.prepare("SELECT rowid FROM vault_notes WHERE id = ?").get(note_id) as { rowid: number } | undefined)?.rowid;
  if (rowid === undefined) return;
  db.prepare("DELETE FROM vault_notes_fts WHERE rowid = ?").run(rowid);
}

/**
 * Executes a full-text search against the vault notes index.
 *
 * IMPORTANT: the `query` parameter is passed directly to FTS5's `MATCH` operator
 * as a raw search expression — it is NOT automatically sanitized. Callers that
 * accept arbitrary user input must escape special FTS5 characters first. The
 * typical sanitation is phrase-wrapping with doubled internal quotes:
 *   `"${userInput.replace(/"/g, '""')}"`
 * See `app/api/notes/search/route.ts` (Task 16) for the canonical sanitation path.
 *
 * Unsanitized input may throw SQLite syntax errors for queries containing FTS5
 * operators (`"`, `*`, `NOT`, `AND`, `OR`, `(`, `)`, `NEAR`, `^`, `-`, `:`).
 */
export function searchVaultNotes(query: string, limit = 50): VaultNoteSearchHit[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT vn.*, snippet(vault_notes_fts, 1, '<mark>', '</mark>', '…', 12) AS snippet, rank
       FROM vault_notes_fts
       JOIN vault_notes vn ON vn.rowid = vault_notes_fts.rowid
       WHERE vault_notes_fts MATCH ? AND vn.deleted_at IS NULL
       ORDER BY rank
       LIMIT ?`
    )
    .all(query, limit) as (VaultNote & { snippet: string; rank: number })[];
  return rows.map((r) => {
    const { snippet, rank, ...note } = r;
    return { note: note as VaultNote, snippet, rank };
  });
}
