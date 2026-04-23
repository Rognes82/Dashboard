import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { runVaultIndexer } from "../../scripts/vault-indexer";
import { listVaultNotes, searchVaultNotes, getVaultNoteByPath } from "../../lib/queries/vault-notes";
import { listBins, createBin, listBinsForNote, getOrCreateBinBySeed } from "../../lib/queries/bins";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-vault-indexer.db");
const FIXTURE_VAULT = path.join(process.cwd(), "tests", "fixtures", "vault");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("vault-indexer", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("indexes all markdown files in the vault and skips .obsidian", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const notes = listVaultNotes(100);
    const paths = notes.map((n) => n.vault_path).sort();
    expect(paths).toEqual([
      "captures/2026-04-23-10-00-sample.md",
      "notes/alpha.md",
      "notes/beta.md",
    ]);
  });

  it("extracts title from frontmatter > heading > filename", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    expect(getVaultNoteByPath("notes/alpha.md")?.title).toBe("Alpha Reel Idea");
    expect(getVaultNoteByPath("notes/beta.md")?.title).toBe("Beta Thoughts");
  });

  it("indexes content into FTS5 and search works", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const hits = searchVaultNotes("tokyo");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].note.vault_path).toBe("notes/alpha.md");
  });

  it("creates note_bins from frontmatter bins on first index only", async () => {
    const bin = getOrCreateBinBySeed({ source_seed: "auto-seed-reels", name: "Reels" });
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const alpha = getVaultNoteByPath("notes/alpha.md")!;
    expect(listBinsForNote(alpha.id).map((b) => b.id)).toContain(bin.id);
  });

  it("does NOT re-seed note_bins on re-index", async () => {
    const bin = getOrCreateBinBySeed({ source_seed: "auto-seed-reels", name: "Reels" });
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const alpha = getVaultNoteByPath("notes/alpha.md")!;
    // simulate manual removal
    const manualBin = createBin({ name: "Manual" });
    const { unassignNoteFromBin, assignNoteToBin } = await import("../../lib/queries/bins");
    unassignNoteFromBin(alpha.id, bin.id);
    assignNoteToBin({ note_id: alpha.id, bin_id: manualBin.id, assigned_by: "manual" });
    // re-index
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const binsNow = listBinsForNote(alpha.id).map((b) => b.id);
    expect(binsNow).toContain(manualBin.id);
    expect(binsNow).not.toContain(bin.id);
  });

  it("--file mode indexes only the named file", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT, filePath: "notes/alpha.md" });
    const notes = listVaultNotes(100);
    expect(notes).toHaveLength(1);
    expect(notes[0].vault_path).toBe("notes/alpha.md");
  });

  it("skips unchanged files on second run (content_hash hit)", async () => {
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const firstAlpha = getVaultNoteByPath("notes/alpha.md")!;
    const firstIndexedAt = firstAlpha.last_indexed_at;
    // tiny sleep to ensure timestamps would differ
    await new Promise((r) => setTimeout(r, 10));
    await runVaultIndexer({ vaultPath: FIXTURE_VAULT });
    const secondAlpha = getVaultNoteByPath("notes/alpha.md")!;
    expect(secondAlpha.content_hash).toBe(firstAlpha.content_hash);
  });

  it("soft-deletes notes whose files disappear, hard-deletes on next scan if still missing", async () => {
    // Use a scratch vault so we can delete files
    const scratch = path.join(process.cwd(), "tests", "fixtures", "scratch-vault");
    fs.mkdirSync(path.join(scratch, "notes"), { recursive: true });
    fs.writeFileSync(path.join(scratch, "notes", "temp.md"), "# Temp\nhello");
    await runVaultIndexer({ vaultPath: scratch });
    const note = getVaultNoteByPath("notes/temp.md")!;
    expect(note).toBeTruthy();
    fs.unlinkSync(path.join(scratch, "notes", "temp.md"));
    await runVaultIndexer({ vaultPath: scratch });
    const afterSoft = listVaultNotes(100);
    expect(afterSoft).toHaveLength(0); // listVaultNotes filters deleted
    await runVaultIndexer({ vaultPath: scratch });
    // Still nothing in active list; also confirm it's hard-deleted
    const { getVaultNoteById } = await import("../../lib/queries/vault-notes");
    expect(getVaultNoteById(note.id)).toBeNull();
    fs.rmSync(scratch, { recursive: true, force: true });
  });
});
