import { getDb } from "../db";
import { newId } from "../utils";
import type { FileRecord, FileSource } from "../types";

export function upsertFile(input: {
  client_id?: string | null;
  project_id?: string | null;
  name: string;
  path: string;
  source: FileSource;
  source_url?: string | null;
  file_type?: string | null;
  size?: number | null;
  modified_at?: string | null;
}): FileRecord {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM files WHERE path = ?").get(input.path) as FileRecord | undefined;
  if (existing) {
    db.prepare(
      `UPDATE files SET client_id = ?, project_id = ?, name = ?, source = ?, source_url = ?, file_type = ?, size = ?, modified_at = ? WHERE id = ?`
    ).run(
      input.client_id ?? null,
      input.project_id ?? null,
      input.name,
      input.source,
      input.source_url ?? null,
      input.file_type ?? null,
      input.size ?? null,
      input.modified_at ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM files WHERE id = ?").get(existing.id) as FileRecord;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO files (id, client_id, project_id, name, path, source, source_url, file_type, size, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.client_id ?? null,
    input.project_id ?? null,
    input.name,
    input.path,
    input.source,
    input.source_url ?? null,
    input.file_type ?? null,
    input.size ?? null,
    input.modified_at ?? null
  );
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRecord;
}

export function listFiles(limit = 500): FileRecord[] {
  const db = getDb();
  return db.prepare("SELECT * FROM files ORDER BY modified_at DESC NULLS LAST LIMIT ?").all(limit) as FileRecord[];
}

export function listFilesByClient(clientId: string, limit = 100): FileRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM files WHERE client_id = ? ORDER BY modified_at DESC NULLS LAST LIMIT ?")
    .all(clientId, limit) as FileRecord[];
}
