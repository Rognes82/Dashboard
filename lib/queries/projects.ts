import { getDb } from "../db";
import { newId } from "../utils";
import type { Project } from "../types";

export function upsertProject(input: {
  client_id: string | null;
  name: string;
  path: string;
  repo_url?: string | null;
  branch?: string | null;
  last_commit_at?: string | null;
  last_commit_message?: string | null;
}): Project {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM projects WHERE path = ?").get(input.path) as Project | undefined;
  if (existing) {
    db.prepare(
      `UPDATE projects SET client_id = ?, name = ?, repo_url = ?, branch = ?, last_commit_at = ?, last_commit_message = ? WHERE id = ?`
    ).run(
      input.client_id,
      input.name,
      input.repo_url ?? null,
      input.branch ?? null,
      input.last_commit_at ?? null,
      input.last_commit_message ?? null,
      existing.id
    );
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(existing.id) as Project;
  }
  const id = newId();
  db.prepare(
    `INSERT INTO projects (id, client_id, name, path, repo_url, branch, last_commit_at, last_commit_message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
  ).run(
    id,
    input.client_id,
    input.name,
    input.path,
    input.repo_url ?? null,
    input.branch ?? null,
    input.last_commit_at ?? null,
    input.last_commit_message ?? null
  );
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project;
}

export function listProjects(): Project[] {
  const db = getDb();
  return db.prepare("SELECT * FROM projects ORDER BY last_commit_at DESC NULLS LAST").all() as Project[];
}

export function listProjectsByClient(clientId: string): Project[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM projects WHERE client_id = ? ORDER BY last_commit_at DESC NULLS LAST")
    .all(clientId) as Project[];
}
