import fs from "fs";
import path from "path";
import { getDb, closeDb } from "../lib/db";
import { runVaultIndexer } from "./vault-indexer";
import { getOrCreateBinBySeed, assignNoteToBin } from "../lib/queries/bins";
import { listVaultNotes } from "../lib/queries/vault-notes";
import { recordSyncRun, readSyncCursor } from "../lib/queries/sync-status";
import { getVaultPath } from "../lib/vault/path";

const IGNORE_TOP_LEVEL = new Set([".obsidian", ".trash", ".git", "node_modules", "_meta"]);

export interface SyncObsidianOptions {
  vaultPath: string;
}

export async function runSyncObsidian(opts: SyncObsidianOptions): Promise<void> {
  const started = Date.now();
  const startedIso = new Date(started).toISOString();
  const vaultAbs = path.resolve(opts.vaultPath);

  // Read cursor BEFORE the indexer runs, since the indexer may update
  // last_indexed_at timestamps. The cursor marks the start of the prior
  // successful sync-obsidian run; we use it to distinguish "first time ever
  // seeing this note" (auto-assign) from "note existed at last run and the
  // user may have curated its bins since" (skip).
  const priorCursor = readSyncCursor("sync-obsidian");

  // Ensure all notes are indexed first
  await runVaultIndexer({ vaultPath: vaultAbs });

  const db = getDb();

  // Create a bin per top-level folder that contains markdown files
  const entries = fs.readdirSync(vaultAbs, { withFileTypes: true });
  const topLevelFolders = entries
    .filter((e) => e.isDirectory() && !IGNORE_TOP_LEVEL.has(e.name))
    .map((e) => e.name);

  for (const folder of topLevelFolders) {
    getOrCreateBinBySeed({
      source_seed: `obsidian:${folder}`,
      name: capitalize(folder),
    });
  }

  // Assign existing notes to their folder's bin. Preservation rules:
  //   1. If the note is already in the target bin → skip (idempotent).
  //   2. If this isn't the first sync-obsidian run AND the note existed at the
  //      time of the prior run (note.created_at <= priorCursor) → skip, because
  //      the user has had a chance to curate and any current absence from the
  //      auto-bin is a deliberate manual removal.
  //   3. If the note has ANY other note_bins rows → skip, because the user has
  //      already curated this note (belt-and-suspenders guard).
  //   4. Otherwise → auto-assign.
  const notes = listVaultNotes(10_000);
  for (const note of notes) {
    const topFolder = note.vault_path.split(path.sep)[0];
    if (!topFolder || IGNORE_TOP_LEVEL.has(topFolder)) continue;
    const bin = getOrCreateBinBySeed({
      source_seed: `obsidian:${topFolder}`,
      name: capitalize(topFolder),
    });
    const alreadyHad = db
      .prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?")
      .get(note.id, bin.id);
    if (alreadyHad) continue;
    // If a prior sync-obsidian run has completed and this note existed then,
    // treat the user as having had the chance to curate. Any absence from the
    // auto-bin is a deliberate removal we must not undo.
    if (priorCursor && note.created_at <= priorCursor) continue;
    // Belt-and-suspenders: if the note has any other bin assignment at all,
    // assume the user has curated it manually.
    const anyBins = db
      .prepare("SELECT COUNT(*) as n FROM note_bins WHERE note_id = ?")
      .get(note.id) as { n: number };
    if (anyBins.n > 0) continue;
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "auto" });
  }

  recordSyncRun({
    sync_name: "sync-obsidian",
    status: "ok",
    duration_ms: Date.now() - started,
    cursor: startedIso,
  });
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

async function main() {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf("--vault");
  const vaultPath = vaultIdx >= 0 ? args[vaultIdx + 1] : getVaultPath();
  try {
    await runSyncObsidian({ vaultPath });
    console.log("[sync-obsidian] ok");
  } catch (err) {
    console.error("[sync-obsidian] error:", err);
    recordSyncRun({ sync_name: "sync-obsidian", status: "error", error_message: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
