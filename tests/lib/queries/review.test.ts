import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { listStaleBins } from "../../../lib/queries/review";
import { createBin, assignNoteToBin } from "../../../lib/queries/bins";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-review.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("listStaleBins", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns bins whose most recent note is older than the threshold", () => {
    const stale = createBin({ name: "Stale" });
    const fresh = createBin({ name: "Fresh" });

    const oldNote = upsertVaultNote({
      vault_path: "a.md",
      title: "Old",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h",
      modified_at: "2026-01-01T00:00:00Z",
    });
    assignNoteToBin({ note_id: oldNote.id, bin_id: stale.id, assigned_by: "manual" });

    const newNote = upsertVaultNote({
      vault_path: "b.md",
      title: "New",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h",
      modified_at: new Date().toISOString(),
    });
    assignNoteToBin({ note_id: newNote.id, bin_id: fresh.id, assigned_by: "manual" });

    const stales = listStaleBins(30);
    expect(stales.map((b) => b.id)).toContain(stale.id);
    expect(stales.map((b) => b.id)).not.toContain(fresh.id);
  });

  it("includes bins with zero active notes", () => {
    const empty = createBin({ name: "Empty" });
    const stales = listStaleBins(30);
    expect(stales.map((b) => b.id)).toContain(empty.id);
  });

  it("reports last_activity per bin (null for empty)", () => {
    const empty = createBin({ name: "Empty" });
    const stale = createBin({ name: "Stale" });
    const note = upsertVaultNote({
      vault_path: "a.md",
      title: "Old",
      source: "obsidian",
      source_id: null,
      source_url: null,
      content_hash: "h",
      modified_at: "2026-01-01T00:00:00Z",
    });
    assignNoteToBin({ note_id: note.id, bin_id: stale.id, assigned_by: "manual" });

    const stales = listStaleBins(30);
    const emptyRow = stales.find((b) => b.id === empty.id)!;
    const staleRow = stales.find((b) => b.id === stale.id)!;
    expect(emptyRow.last_activity).toBeNull();
    expect(staleRow.last_activity).toBe("2026-01-01T00:00:00Z");
  });
});
