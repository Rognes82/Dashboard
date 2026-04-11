import { getDb } from "../db";
import { newId } from "../utils";
import type { Agent, AgentType, AgentStatus } from "../types";

export function upsertAgent(input: {
  name: string;
  type: AgentType;
  schedule?: string | null;
  host?: string;
  status: AgentStatus;
  last_run_at?: string | null;
  last_output?: string | null;
  config_path?: string | null;
}): Agent {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM agents WHERE name = ?").get(input.name) as Agent | undefined;
  if (existing) {
    db.prepare(
      `UPDATE agents SET type = ?, schedule = ?, host = ?, status = ?, last_run_at = ?, last_output = ?, config_path = ? WHERE id = ?`
    ).run(
      input.type,
      input.schedule ?? null,
      input.host ?? "mac_mini",
      input.status,
      input.last_run_at ?? null,
      input.last_output ?? null,
      input.config_path ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM agents WHERE id = ?").get(existing.id) as Agent;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO agents (id, name, type, schedule, host, status, last_run_at, last_output, config_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.type,
    input.schedule ?? null,
    input.host ?? "mac_mini",
    input.status,
    input.last_run_at ?? null,
    input.last_output ?? null,
    input.config_path ?? null
  );
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent;
}

export function listAgents(): Agent[] {
  const db = getDb();
  return db.prepare("SELECT * FROM agents ORDER BY name ASC").all() as Agent[];
}

export function getAgentByName(name: string): Agent | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as Agent | undefined;
  return row ?? null;
}
