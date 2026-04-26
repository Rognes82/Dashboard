import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  upsertVaultNote,
  listVaultNotesWithBins,
  listVaultNotesByBinWithBins,
} from "../../../lib/queries/vault-notes";
import { createBin, assignNoteToBin } from "../../../lib/queries/bins";
import { nowIso } from "../../../lib/utils";

const TEST_DB = path.join(process.cwd(), "data", "test-notes-with-bins.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function fixtureNote(vault_path: string) {
  return upsertVaultNote({
    vault_path, source: "obsidian",
    source_id: null, source_url: null,
    title: "T", content_hash: "h", modified_at: nowIso(),
  });
}

describe("listVaultNotesWithBins", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns empty bins[] for unassigned notes", () => {
    fixtureNote("a.md");
    const result = listVaultNotesWithBins(100);
    expect(result).toHaveLength(1);
    expect(result[0].bins).toEqual([]);
  });

  it("returns single bin id for note in one bin", () => {
    const note = fixtureNote("a.md");
    const bin = createBin({ name: "A" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "manual" });
    const result = listVaultNotesWithBins(100);
    expect(result[0].bins).toEqual([bin.id]);
  });

  it("returns sorted bin ids for note in multiple bins", () => {
    const note = fixtureNote("a.md");
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    assignNoteToBin({ note_id: note.id, bin_id: a.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: note.id, bin_id: b.id, assigned_by: "manual" });
    const result = listVaultNotesWithBins(100);
    expect(result[0].bins).toEqual([a.id, b.id].sort());
  });
});

describe("listVaultNotesByBinWithBins", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns notes in a bin with their bin assignments", () => {
    const note1 = fixtureNote("a.md");
    const note2 = fixtureNote("b.md");
    const bin = createBin({ name: "Filter" });
    const otherBin = createBin({ name: "Other" });
    assignNoteToBin({ note_id: note1.id, bin_id: bin.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: note1.id, bin_id: otherBin.id, assigned_by: "manual" });
    // note2 not in bin — should be excluded
    assignNoteToBin({ note_id: note2.id, bin_id: otherBin.id, assigned_by: "manual" });

    const result = listVaultNotesByBinWithBins(bin.id, 100);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(note1.id);
    expect(result[0].bins).toEqual([bin.id, otherBin.id].sort());
  });
});
