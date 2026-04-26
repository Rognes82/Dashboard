import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb } from "../../../lib/db";
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
  isDescendantOf,
  moveNoteBetweenBins,
  getBinDeletePreview,
  getBinMergePreview,
  NoteNotInSourceBinError,
} from "../../../lib/queries/bins";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import { nowIso } from "../../../lib/utils";
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

  it("schema declares bins.sort_order as REAL for fractional drag-reorder", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(bins)").all() as Array<{ name: string; type: string }>;
    const sortOrder = cols.find((c) => c.name === "sort_order");
    expect(sortOrder?.type).toBe("REAL");
  });

  describe("isDescendantOf", () => {
    it("returns true for direct child", () => {
      const parent = createBin({ name: "P" });
      const child = createBin({ name: "C", parent_bin_id: parent.id });
      expect(isDescendantOf(child.id, parent.id)).toBe(true);
    });
    it("returns true for grandchild", () => {
      const a = createBin({ name: "A" });
      const b = createBin({ name: "B", parent_bin_id: a.id });
      const c = createBin({ name: "C", parent_bin_id: b.id });
      expect(isDescendantOf(c.id, a.id)).toBe(true);
    });
    it("returns false for sibling", () => {
      const parent = createBin({ name: "P" });
      const a = createBin({ name: "A", parent_bin_id: parent.id });
      const b = createBin({ name: "B", parent_bin_id: parent.id });
      expect(isDescendantOf(a.id, b.id)).toBe(false);
    });
    it("returns false for self", () => {
      const a = createBin({ name: "A" });
      expect(isDescendantOf(a.id, a.id)).toBe(false);
    });
    it("returns false for unrelated bins", () => {
      const a = createBin({ name: "A" });
      const b = createBin({ name: "B" });
      expect(isDescendantOf(a.id, b.id)).toBe(false);
    });
  });

  describe("moveNoteBetweenBins", () => {
    it("moves a note from source to target atomically", () => {
      const noteRow = upsertVaultNote({
        vault_path: "test/note1.md", source: "obsidian",
        source_id: null, source_url: null,
        title: "T", content_hash: "h", modified_at: nowIso(),
      });
      const a = createBin({ name: "A" });
      const b = createBin({ name: "B" });
      assignNoteToBin({ note_id: noteRow.id, bin_id: a.id, assigned_by: "manual" });
      moveNoteBetweenBins(noteRow.id, a.id, b.id);
      const bins = listBinsForNote(noteRow.id).map((x) => x.id);
      expect(bins).toEqual([b.id]);
    });

    it("throws if note is not in source bin", () => {
      const noteRow = upsertVaultNote({
        vault_path: "test/note2.md", source: "obsidian",
        source_id: null, source_url: null,
        title: "T", content_hash: "h", modified_at: nowIso(),
      });
      const a = createBin({ name: "A" });
      const b = createBin({ name: "B" });
      expect(() => moveNoteBetweenBins(noteRow.id, a.id, b.id)).toThrow(/not in source bin/);
    });
  });

  describe("mergeBin re-parents children", () => {
    it("preserves source's children by re-parenting them to target", () => {
      const source = createBin({ name: "Drafts" });
      const target = createBin({ name: "Notes" });
      const child1 = createBin({ name: "WIP", parent_bin_id: source.id });
      const child2 = createBin({ name: "Old", parent_bin_id: source.id });
      mergeBin(source.id, target.id);
      expect(getBinById(source.id)).toBeNull();
      expect(getBinById(child1.id)?.parent_bin_id).toBe(target.id);
      expect(getBinById(child2.id)?.parent_bin_id).toBe(target.id);
    });
    it("still merges note assignments idempotently", () => {
      const noteRow = upsertVaultNote({
        vault_path: "test/note-merge.md", source: "obsidian",
        source_id: null, source_url: null,
        title: "T", content_hash: "h", modified_at: nowIso(),
      });
      const source = createBin({ name: "S" });
      const target = createBin({ name: "T" });
      assignNoteToBin({ note_id: noteRow.id, bin_id: source.id, assigned_by: "manual" });
      assignNoteToBin({ note_id: noteRow.id, bin_id: target.id, assigned_by: "manual" });
      mergeBin(source.id, target.id);
      const bins = listBinsForNote(noteRow.id).map((x) => x.id);
      expect(bins).toEqual([target.id]);
    });
  });

  describe("getBinDeletePreview", () => {
    it("returns zero counts for an empty bin", () => {
      const bin = createBin({ name: "Empty" });
      const preview = getBinDeletePreview(bin.id);
      expect(preview).toEqual({
        child_bin_count: 0,
        child_bin_names: [],
        has_more_children: false,
        note_count: 0,
      });
    });
    it("counts direct + recursive descendants", () => {
      const root = createBin({ name: "Root" });
      const c1 = createBin({ name: "alpha", parent_bin_id: root.id });
      const c2 = createBin({ name: "bravo", parent_bin_id: root.id });
      createBin({ name: "grand", parent_bin_id: c1.id });
      const preview = getBinDeletePreview(root.id);
      expect(preview.child_bin_count).toBe(3); // c1 + c2 + grand
      expect(preview.child_bin_names).toEqual(["alpha", "bravo"]);
      expect(preview.has_more_children).toBe(false);
    });
    it("limits child_bin_names to first 5 alphabetical and sets has_more_children", () => {
      const root = createBin({ name: "Root" });
      ["e", "d", "c", "b", "a", "g", "f"].forEach((n) =>
        createBin({ name: n, parent_bin_id: root.id })
      );
      const preview = getBinDeletePreview(root.id);
      expect(preview.child_bin_names).toEqual(["a", "b", "c", "d", "e"]);
      expect(preview.has_more_children).toBe(true);
    });
    it("counts distinct notes once even if assigned to multiple descendants", () => {
      const noteRow = upsertVaultNote({
        vault_path: "test/dist.md", source: "obsidian",
        source_id: null, source_url: null,
        title: "T", content_hash: "h", modified_at: nowIso(),
      });
      const root = createBin({ name: "Root" });
      const a = createBin({ name: "A", parent_bin_id: root.id });
      const b = createBin({ name: "B", parent_bin_id: root.id });
      assignNoteToBin({ note_id: noteRow.id, bin_id: a.id, assigned_by: "manual" });
      assignNoteToBin({ note_id: noteRow.id, bin_id: b.id, assigned_by: "manual" });
      expect(getBinDeletePreview(root.id).note_count).toBe(1);
    });
  });

  describe("getBinMergePreview", () => {
    it("counts only direct children and direct note assignments", () => {
      const noteRow = upsertVaultNote({
        vault_path: "test/merge-pv.md", source: "obsidian",
        source_id: null, source_url: null,
        title: "T", content_hash: "h", modified_at: nowIso(),
      });
      const root = createBin({ name: "Root" });
      const directChild = createBin({ name: "Direct", parent_bin_id: root.id });
      createBin({ name: "Grand", parent_bin_id: directChild.id }); // NOT counted
      assignNoteToBin({ note_id: noteRow.id, bin_id: root.id, assigned_by: "manual" });
      const preview = getBinMergePreview(root.id);
      expect(preview.direct_child_count).toBe(1);
      expect(preview.direct_note_count).toBe(1);
    });
    it("returns zero counts for empty bin", () => {
      const bin = createBin({ name: "Empty" });
      expect(getBinMergePreview(bin.id)).toEqual({ direct_child_count: 0, direct_note_count: 0 });
    });
  });

  describe("NoteNotInSourceBinError", () => {
    it("moveNoteBetweenBins throws NoteNotInSourceBinError when note not in source", () => {
      const noteRow = upsertVaultNote({
        vault_path: "test/typed-error.md", source: "obsidian",
        source_id: null, source_url: null,
        title: "T", content_hash: "h", modified_at: nowIso(),
      });
      const a = createBin({ name: "A" });
      const b = createBin({ name: "B" });
      expect(() => moveNoteBetweenBins(noteRow.id, a.id, b.id)).toThrow(NoteNotInSourceBinError);
    });

    it("NoteNotInSourceBinError carries noteId and fromBinId", () => {
      const noteRow = upsertVaultNote({
        vault_path: "test/typed-error-2.md", source: "obsidian",
        source_id: null, source_url: null,
        title: "T", content_hash: "h", modified_at: nowIso(),
      });
      const a = createBin({ name: "A" });
      const b = createBin({ name: "B" });
      try {
        moveNoteBetweenBins(noteRow.id, a.id, b.id);
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NoteNotInSourceBinError);
        if (err instanceof NoteNotInSourceBinError) {
          expect(err.noteId).toBe(noteRow.id);
          expect(err.fromBinId).toBe(a.id);
        }
      }
    });
  });
});
