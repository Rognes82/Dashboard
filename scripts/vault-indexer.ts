import fastGlob from "fast-glob";
import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../lib/db";
import { nowIso } from "../lib/utils";
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
import type { VaultNoteSource } from "../lib/types";

const IGNORE_GLOBS = ["**/.obsidian/**", "**/.trash/**", "**/.git/**", "**/node_modules/**", "**/*.icloud"];

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
    // Frontmatter `bins:` entries may be either bin ids or human-readable source_seed
    // tokens. Resolve each entry to a real bin row (source_seed first, then id).
    const isFirstIndex = existing === null;
    if (isFirstIndex && Array.isArray(frontmatter.bins)) {
      const resolveBin = db.prepare(
        "SELECT id FROM bins WHERE source_seed = ? OR id = ? LIMIT 1"
      );
      for (const binRef of frontmatter.bins as unknown[]) {
        if (typeof binRef !== "string") continue;
        const row = resolveBin.get(binRef, binRef) as { id: string } | undefined;
        if (row) {
          assignNoteToBin({ note_id: note.id, bin_id: row.id, assigned_by: "auto" });
        }
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
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");
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
