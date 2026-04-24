import fs from "fs";
import path from "path";
import { getDb } from "../db";
import { searchVaultNotes } from "../queries/vault-notes";
import { parseFrontmatter } from "../vault/frontmatter";
import type { ContextNote } from "./prompt";

const BYTES_PER_TOKEN = 4;
const BUDGET_FRACTION = 0.6;

export function sanitizeFtsQuery(raw: string): string {
  const normalized = raw.trim().replace(/\s+/g, " ");
  return `"${normalized.replace(/"/g, '""')}"`;
}

export function resolveScopedBinIds(rootId: string): string[] {
  const db = getDb();
  const ids = new Set<string>([rootId]);
  const frontier = [rootId];
  while (frontier.length > 0) {
    const id = frontier.shift()!;
    const rows = db
      .prepare("SELECT id FROM bins WHERE parent_bin_id = ?")
      .all(id) as { id: string }[];
    for (const r of rows) {
      if (!ids.has(r.id)) {
        ids.add(r.id);
        frontier.push(r.id);
      }
    }
  }
  return Array.from(ids);
}

export interface AssembleContextOptions {
  query: string;
  scope_bin_id: string | null;
  vault_path: string;
  max_context_tokens: number;
}

export function assembleContext(opts: AssembleContextOptions): ContextNote[] {
  const safe = sanitizeFtsQuery(opts.query);
  const hits = searchVaultNotes(safe, 20);

  let allowedNoteIds: Set<string> | null = null;
  if (opts.scope_bin_id) {
    const binIds = resolveScopedBinIds(opts.scope_bin_id);
    const placeholders = binIds.map(() => "?").join(",");
    const rows = getDb()
      .prepare(`SELECT DISTINCT note_id FROM note_bins WHERE bin_id IN (${placeholders})`)
      .all(...binIds) as { note_id: string }[];
    allowedNoteIds = new Set(rows.map((r) => r.note_id));
  }

  const budgetBytes = Math.floor(opts.max_context_tokens * BUDGET_FRACTION * BYTES_PER_TOKEN);
  const out: ContextNote[] = [];
  let used = 0;

  for (const hit of hits) {
    if (allowedNoteIds && !allowedNoteIds.has(hit.note.id)) continue;
    const abs = path.join(opts.vault_path, hit.note.vault_path);
    let raw: string;
    try {
      raw = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    const { body } = parseFrontmatter(raw);
    const cleanedBody = body.trimStart();
    const entrySize = hit.note.vault_path.length + cleanedBody.length + 20;
    if (used + entrySize > budgetBytes && out.length >= 3) break;
    let finalBody = cleanedBody;
    if (used + entrySize > budgetBytes) {
      const remaining = Math.max(0, budgetBytes - used - hit.note.vault_path.length - 20);
      finalBody = cleanedBody.slice(0, remaining);
    }
    out.push({ vault_path: hit.note.vault_path, body: finalBody });
    used += hit.note.vault_path.length + finalBody.length + 20;
    if (used >= budgetBytes) break;
  }

  return out;
}
