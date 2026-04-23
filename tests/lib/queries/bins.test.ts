import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  createBin,
  getBinById,
  listBins,
  listBinTree,
  updateBin,
  deleteBin,
  assignNoteToBin,
  unassignNoteFromBin,
  listBinsForNote,
  mergeBin,
  getOrCreateBinBySeed,
} from "../../../lib/queries/bins";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-bins.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function fixtureNote(vault_path = "notes/a.md") {
  return upsertVaultNote({
    vault_path,
    title: "X",
    source: "obsidian",
    source_id: null,
    source_url: null,
    content_hash: "h",
    modified_at: "2026-04-23T10:00:00Z",
  });
}

describe("bins queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("createBin + getBinById round-trip", () => {
    const bin = createBin({ name: "Content" });
    expect(bin.id).toHaveLength(26);
    expect(getBinById(bin.id)?.name).toBe("Content");
  });

  it("createBin with parent nests correctly", () => {
    const parent = createBin({ name: "Content" });
    const child = createBin({ name: "Reels", parent_bin_id: parent.id });
    expect(child.parent_bin_id).toBe(parent.id);
  });

  it("listBinTree builds nested structure with note counts", () => {
    const parent = createBin({ name: "Content" });
    const child = createBin({ name: "Reels", parent_bin_id: parent.id });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: child.id, assigned_by: "manual" });
    const tree = listBinTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("Content");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("Reels");
    expect(tree[0].children[0].note_count).toBe(1);
  });

  it("updateBin changes name and parent", () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    const updated = updateBin(b.id, { name: "B2", parent_bin_id: a.id });
    expect(updated?.name).toBe("B2");
    expect(updated?.parent_bin_id).toBe(a.id);
  });

  it("deleteBin cascades to children and note_bins", () => {
    const parent = createBin({ name: "P" });
    const child = createBin({ name: "C", parent_bin_id: parent.id });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: child.id, assigned_by: "manual" });
    deleteBin(parent.id);
    expect(getBinById(parent.id)).toBeNull();
    expect(getBinById(child.id)).toBeNull();
    expect(listBinsForNote(note.id)).toHaveLength(0);
  });

  it("assignNoteToBin is idempotent on (note, bin) pair", () => {
    const bin = createBin({ name: "B" });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "auto" });
    const bins = listBinsForNote(note.id);
    expect(bins).toHaveLength(1);
  });

  it("unassignNoteFromBin removes the row", () => {
    const bin = createBin({ name: "B" });
    const note = fixtureNote();
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "manual" });
    unassignNoteFromBin(note.id, bin.id);
    expect(listBinsForNote(note.id)).toHaveLength(0);
  });

  it("mergeBin moves all note_bins from source to target and deletes source", () => {
    const src = createBin({ name: "Source" });
    const tgt = createBin({ name: "Target" });
    const n1 = fixtureNote("a.md");
    const n2 = fixtureNote("b.md");
    assignNoteToBin({ note_id: n1.id, bin_id: src.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: n2.id, bin_id: src.id, assigned_by: "auto" });
    mergeBin(src.id, tgt.id);
    expect(getBinById(src.id)).toBeNull();
    expect(listBinsForNote(n1.id).map((b) => b.id)).toContain(tgt.id);
    expect(listBinsForNote(n2.id).map((b) => b.id)).toContain(tgt.id);
  });

  it("mergeBin handles overlapping memberships without duplicate PK violation", () => {
    const src = createBin({ name: "Source" });
    const tgt = createBin({ name: "Target" });
    const n = fixtureNote();
    assignNoteToBin({ note_id: n.id, bin_id: src.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: n.id, bin_id: tgt.id, assigned_by: "manual" });
    mergeBin(src.id, tgt.id);
    expect(listBinsForNote(n.id)).toHaveLength(1);
  });

  it("getOrCreateBinBySeed is idempotent", () => {
    const a = getOrCreateBinBySeed({ source_seed: "obsidian:Content", name: "Content" });
    const b = getOrCreateBinBySeed({ source_seed: "obsidian:Content", name: "Content" });
    expect(a.id).toBe(b.id);
  });
});
