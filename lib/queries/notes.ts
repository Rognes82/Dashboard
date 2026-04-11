import { getDb } from "../db";
import { newId } from "../utils";
import type { Note, NoteSource } from "../types";

export function upsertNote(input: {
  client_id?: string | null;
  title: string;
  content_preview?: string | null;
  source: NoteSource;
  source_url: string;
  tags?: string | null;
  modified_at?: string | null;
}): Note {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM notes WHERE source_url = ?").get(input.source_url) as Note | undefined;
  if (existing) {
    db.prepare(
      `UPDATE notes SET client_id = ?, title = ?, content_preview = ?, source = ?, tags = ?, modified_at = ? WHERE id = ?`
    ).run(
      input.client_id ?? null,
      input.title,
      input.content_preview ?? null,
      input.source,
      input.tags ?? null,
      input.modified_at ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM notes WHERE id = ?").get(existing.id) as Note;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO notes (id, client_id, title, content_preview, source, source_url, tags, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.client_id ?? null,
    input.title,
    input.content_preview ?? null,
    input.source,
    input.source_url,
    input.tags ?? null,
    input.modified_at ?? null
  );
  return db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as Note;
}

export function listNotes(limit = 200): Note[] {
  const db = getDb();
  return db.prepare("SELECT * FROM notes ORDER BY modified_at DESC NULLS LAST LIMIT ?").all(limit) as Note[];
}

export function listNotesByClient(clientId: string, limit = 50): Note[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM notes WHERE client_id = ? ORDER BY modified_at DESC NULLS LAST LIMIT ?")
    .all(clientId, limit) as Note[];
}
