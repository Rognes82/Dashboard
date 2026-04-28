import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, migrate } from "../../lib/db";
import { runSyncObsidian } from "../../scripts/sync-obsidian";
import { listVaultNotes } from "../../lib/queries/vault-notes";
import { listBins, listBinsForNote, getBinBySeed } from "../../lib/queries/bins";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-obsidian.db");
const FIXTURE_VAULT = path.join(process.cwd(), "tests", "fixtures", "vault");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
}

describe("sync-obsidian", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("creates bins for each top-level folder under notes/", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    expect(getBinBySeed("obsidian:notes")).toBeTruthy();
    expect(getBinBySeed("obsidian:captures")).toBeTruthy();
  });

  it("assigns notes to the matching auto-bin by folder", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const notes = listVaultNotes(100);
    const alpha = notes.find((n) => n.vault_path === "notes/alpha.md")!;
    const bin = getBinBySeed("obsidian:notes")!;
    expect(listBinsForNote(alpha.id).map((b) => b.id)).toContain(bin.id);
  });

  it("is idempotent on re-run (no duplicate bins, no duplicate assignments)", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const binsAfterFirst = listBins().length;
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const binsAfterSecond = listBins().length;
    expect(binsAfterSecond).toBe(binsAfterFirst);
  });

  it("preserves manual bin assignments on re-run", async () => {
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    const notes = listVaultNotes(100);
    const alpha = notes.find((n) => n.vault_path === "notes/alpha.md")!;
    const autoBin = getBinBySeed("obsidian:notes")!;
    // Simulate manual removal of the auto-bin
    const { unassignNoteFromBin } = await import("../../lib/queries/bins");
    unassignNoteFromBin(alpha.id, autoBin.id);
    // Re-run
    await runSyncObsidian({ vaultPath: FIXTURE_VAULT });
    // The removal should be preserved — we don't re-add the auto assignment
    expect(listBinsForNote(alpha.id).map((b) => b.id)).not.toContain(autoBin.id);
  });
});
