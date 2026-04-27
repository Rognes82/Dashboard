import fastGlob from "fast-glob";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../lib/db";
import { nowIso, slugify } from "../lib/utils";
import { hashContent } from "../lib/vault/hash";
import { parseFrontmatter, extractInlineTags } from "../lib/vault/frontmatter";
import { markdownToPlainText, deriveTitle } from "../lib/vault/markdown";
import {
  upsertVaultNote,
  getVaultNoteByPath,
  updateFtsRow,
  softDeleteVaultNote,
  hardDeleteVaultNote,
} from "../lib/queries/vault-notes";
import { assignNoteToBin } from "../lib/queries/bins";
import { recordSyncRun } from "../lib/queries/sync-status";
import { getVaultPath } from "../lib/vault/path";
import type { VaultNoteSource } from "../lib/types";

const IGNORE_GLOBS = ["**/.obsidian/**", "**/.trash/**", "**/.git/**", "**/node_modules/**", "**/*.icloud"];

interface BinLookupRow {
  id: string;
  name: string;
  parent_bin_id: string | null;
  source_seed: string | null;
}

function normalizeBinPathRef(ref: string): string {
  return ref
    .trim()
    .split("/")
    .map((segment) => slugify(segment))
    .filter(Boolean)
    .join("/");
}

function buildBinRefLookup(db: ReturnType<typeof getDb>): Map<string, string> {
  const rows = db.prepare("SELECT id, name, parent_bin_id, source_seed FROM bins").all() as BinLookupRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pathCache = new Map<string, string | null>();

  function pathFor(row: BinLookupRow): string | null {
    if (pathCache.has(row.id)) return pathCache.get(row.id) ?? null;
    const slug = slugify(row.name);
    if (!slug) {
      pathCache.set(row.id, null);
      return null;
    }
    if (!row.parent_bin_id) {
      pathCache.set(row.id, slug);
      return slug;
    }
    const parent = byId.get(row.parent_bin_id);
    const parentPath = parent ? pathFor(parent) : null;
    const fullPath = parentPath ? `${parentPath}/${slug}` : slug;
    pathCache.set(row.id, fullPath);
    return fullPath;
  }

  const lookup = new Map<string, string>();
  for (const row of rows) {
    lookup.set(row.id, row.id);
    if (row.source_seed) lookup.set(row.source_seed, row.id);
    const slugPath = pathFor(row);
    if (slugPath) lookup.set(slugPath, row.id);
  }
  return lookup;
}

export interface RunOptions {
  vaultPath: string;
  filePath?: string;         // relative to vaultPath — single-file mode
}

export async function runVaultIndexer(opts: RunOptions): Promise<void> {
  const started = Date.now();
  const db = getDb();

  const vaultAbs = path.resolve(opts.vaultPath);
  if (!fs.existsSync(vaultAbs)) {
    throw new Error(`vault path does not exist: ${vaultAbs}`);
  }

  const relativePaths = opts.filePath
    ? [opts.filePath]
    : await fastGlob("**/*.md", { cwd: vaultAbs, ignore: IGNORE_GLOBS, dot: false });

  const seenPaths = new Set<string>();

  for (const rel of relativePaths) {
    const abs = path.join(vaultAbs, rel);
    if (!fs.existsSync(abs)) continue;
    const stat = fs.statSync(abs);
    const raw = fs.readFileSync(abs, "utf-8");
    const hash = hashContent(raw);
    const existing = getVaultNoteByPath(rel);
    seenPaths.add(rel);

    if (existing && existing.content_hash === hash && existing.deleted_at === null) {
      // No content change — touch last_indexed_at only
      db.prepare("UPDATE vault_notes SET last_indexed_at = ?, modified_at = ? WHERE id = ?")
        .run(nowIso(), stat.mtime.toISOString(), existing.id);
      continue;
    }

    const { data: frontmatter, body } = parseFrontmatter(raw);
    const title = deriveTitle(frontmatter, body, rel);
    const source: VaultNoteSource =
      (typeof frontmatter.source === "string" && ["notion", "obsidian", "capture", "apple-notes"].includes(frontmatter.source))
        ? (frontmatter.source as VaultNoteSource)
        : rel.startsWith("notion-sync/")
        ? "notion"
        : rel.startsWith("captures/")
        ? "capture"
        : "obsidian";
    const source_id = typeof frontmatter.source_id === "string" ? frontmatter.source_id : null;
    const source_url = typeof frontmatter.source_url === "string" ? frontmatter.source_url : null;

    const note = upsertVaultNote({
      vault_path: rel,
      title,
      source,
      source_id,
      source_url,
      content_hash: hash,
      modified_at: stat.mtime.toISOString(),
      created_at:
        typeof frontmatter.created_at === "string" ? frontmatter.created_at : stat.birthtime.toISOString(),
    });

    // Refresh FTS
    const plainText = markdownToPlainText(body);
    const fmTags = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];
    const inlineTags = extractInlineTags(body);
    const allTags = Array.from(new Set([...fmTags, ...inlineTags]));
    updateFtsRow({
      note_id: note.id,
      title,
      plain_text: plainText,
      tags: allTags.join(" "),
    });

    // Refresh note_tags table
    db.prepare("DELETE FROM note_tags WHERE note_id = ?").run(note.id);
    const insertTag = db.prepare("INSERT INTO note_tags (note_id, tag) VALUES (?, ?)");
    for (const tag of allTags) insertTag.run(note.id, tag);

    // Seed bins from frontmatter — ONLY on first index of this file.
    // Frontmatter `bins:` entries may be bin ids, source_seed tokens, or
    // user-facing slug paths like `travel/japan`.
    const isFirstIndex = existing === null;
    if (isFirstIndex && Array.isArray(frontmatter.bins)) {
      const binLookup = buildBinRefLookup(db);
      const unresolvedBins: string[] = [];
      for (const binRef of frontmatter.bins as unknown[]) {
        if (typeof binRef !== "string") continue;
        const binId = binLookup.get(binRef.trim()) ?? binLookup.get(normalizeBinPathRef(binRef));
        if (binId) {
          assignNoteToBin({ note_id: note.id, bin_id: binId, assigned_by: "auto" });
        } else {
          unresolvedBins.push(binRef);
        }
      }
      if (unresolvedBins.length > 0) {
        console.warn(`[vault-indexer] unresolved bins for ${rel}: ${unresolvedBins.join(", ")}`);
      }
      // v1.3: explicit frontmatter bin assignment means user has placed this note;
      // classifier should skip it on future runs.
      if (frontmatter.bins.length > 0) {
        db.prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(note.id);
      }
    }
  }

  // Deletion handling (only in full-scan mode). We must include soft-deleted
  // rows here so a file that stayed missing gets promoted from soft → hard
  // delete on the second scan. `listAllIndexedPaths()` filters them out, so
  // query directly.
  if (!opts.filePath) {
    const allRows = db
      .prepare("SELECT vault_path FROM vault_notes")
      .all() as { vault_path: string }[];
    for (const row of allRows) {
      if (!seenPaths.has(row.vault_path)) {
        const existing = getVaultNoteByPath(row.vault_path);
        if (!existing) continue;
        if (existing.deleted_at === null) {
          softDeleteVaultNote(existing.id);
        } else {
          hardDeleteVaultNote(existing.id);
        }
      }
    }
  }

  recordSyncRun({
    sync_name: "vault-indexer",
    status: "ok",
    duration_ms: Date.now() - started,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf("--vault");
  const fileIdx = args.indexOf("--file");
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : getVaultPath();
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : undefined;
  try {
    await runVaultIndexer({ vaultPath, filePath });
    console.log(`[vault-indexer] ok ${filePath ? `(file: ${filePath})` : ""}`);
  } catch (err) {
    console.error("[vault-indexer] error:", err);
    recordSyncRun({
      sync_name: "vault-indexer",
      status: "error",
      error_message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
