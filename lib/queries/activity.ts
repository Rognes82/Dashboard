import { getDb } from "../db";
import { newId, nowIso } from "../utils";
import type { ActivityEntry } from "../types";

export function recordActivity(input: {
  client_id?: string | null;
  agent_id?: string | null;
  source: string;
  event_type: string;
  title: string;
  detail?: string | null;
  timestamp?: string;
}): ActivityEntry {
  const db = getDb();
  const id = newId();
  const timestamp = input.timestamp ?? nowIso();
  db.prepare(
    `INSERT INTO activity (id, client_id, agent_id, source, event_type, title, detail, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.client_id ?? null,
    input.agent_id ?? null,
    input.source,
    input.event_type,
    input.title,
    input.detail ?? null,
    timestamp
  );
  return db.prepare("SELECT * FROM activity WHERE id = ?").get(id) as ActivityEntry;
}

export function listRecentActivity(limit = 50): ActivityEntry[] {
  const db = getDb();
  return db.prepare("SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?").all(limit) as ActivityEntry[];
}

export function listActivityByClient(clientId: string, limit = 50): ActivityEntry[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM activity WHERE client_id = ? ORDER BY timestamp DESC LIMIT ?")
    .all(clientId, limit) as ActivityEntry[];
}
