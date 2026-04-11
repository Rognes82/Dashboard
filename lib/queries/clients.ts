import { getDb } from "../db";
import { newId, nowIso, slugify } from "../utils";
import type { Client, ClientStatus } from "../types";

export function createClient(input: {
  name: string;
  pipeline_stage?: string;
  notes?: string;
}): Client {
  const db = getDb();
  const id = newId();
  const slug = slugify(input.name);
  const now = nowIso();
  db.prepare(
    `INSERT INTO clients (id, name, slug, status, pipeline_stage, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(id, input.name, slug, input.pipeline_stage ?? null, input.notes ?? null, now, now);
  return getClientBySlug(slug)!;
}

export function listClients(): Client[] {
  const db = getDb();
  return db.prepare("SELECT * FROM clients ORDER BY name ASC").all() as Client[];
}

export function getClientBySlug(slug: string): Client | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM clients WHERE slug = ?").get(slug) as Client | undefined;
  return row ?? null;
}

export function getClientById(id: string): Client | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as Client | undefined;
  return row ?? null;
}

export function updateClientStatus(
  id: string,
  status: ClientStatus,
  pipeline_stage?: string
): Client | null {
  const db = getDb();
  db.prepare(
    `UPDATE clients SET status = ?, pipeline_stage = ?, updated_at = ? WHERE id = ?`
  ).run(status, pipeline_stage ?? null, nowIso(), id);
  return getClientById(id);
}
