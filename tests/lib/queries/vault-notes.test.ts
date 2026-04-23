import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  upsertVaultNote,
  getVaultNoteById,
  getVaultNoteByPath,
  getVaultNoteBySourceId,
  listVaultNotes,
  listVaultNotesByClient,
  listRecentVaultNotes,
  listUncategorizedVaultNotes,
  softDeleteVaultNote,
  hardDeleteVaultNote,
  updateFtsRow,
  deleteFtsRow,
  searchVaultNotes,
} from "../../../lib/queries/vault-notes";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-vault-notes.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function fixtureNote(overrides: Partial<Parameters<typeof upsertVaultNote>[0]> = {}) {
  return upsertVaultNote({
    vault_path: "notes/alpha.md",
    title: "Alpha",
    source: "obsidian",
    source_id: null,
    source_url: null,
    content_hash: "hash-1",
    modified_at: "2026-04-23T10:00:00Z",
    ...overrides,
  });
}

describe("vault-notes queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertVaultNote creates a row on first call", () => {
    const note = fixtureNote();
    expect(note.id).toHaveLength(26);
    expect(note.vault_path).toBe("notes/alpha.md");
    expect(note.title).toBe("Alpha");
  });

  it("upsertVaultNote updates the same row on second call by path", () => {
    const first = fixtureNote();
    const second = fixtureNote({ title: "Alpha Renamed", content_hash: "hash-2" });
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("Alpha Renamed");
    expect(second.content_hash).toBe("hash-2");
  });

  it("upsertVaultNote with source_id updates by source_id even if path changes", () => {
    const first = fixtureNote({ source: "notion", source_id: "notion-page-1", vault_path: "notion-sync/db/alpha.md" });
    const second = upsertVaultNote({
      vault_path: "notion-sync/db/alpha-renamed.md",
      title: "Alpha Renamed",
      source: "notion",
      source_id: "notion-page-1",
      source_url: null,
      content_hash: "hash-2",
      modified_at: "2026-04-23T10:05:00Z",
    });
    expect(second.id).toBe(first.id);
    expect(second.vault_path).toBe("notion-sync/db/alpha-renamed.md");
  });

  it("getVaultNoteById returns null for missing", () => {
    expect(getVaultNoteById("nope")).toBeNull();
  });

  it("getVaultNoteByPath returns the row", () => {
    const note = fixtureNote();
    expect(getVaultNoteByPath("notes/alpha.md")?.id).toBe(note.id);
  });

  it("getVaultNoteBySourceId returns only when not null", () => {
    fixtureNote({ source: "notion", source_id: "nx-1" });
    expect(getVaultNoteBySourceId("nx-1")?.source_id).toBe("nx-1");
    expect(getVaultNoteBySourceId("missing")).toBeNull();
  });

  it("listVaultNotes orders by modified_at desc", () => {
    fixtureNote({ vault_path: "a.md", title: "A", modified_at: "2026-04-23T10:00:00Z" });
    fixtureNote({ vault_path: "b.md", title: "B", modified_at: "2026-04-23T11:00:00Z" });
    const list = listVaultNotes(10);
    expect(list[0].title).toBe("B");
    expect(list[1].title).toBe("A");
  });

  it("softDeleteVaultNote sets deleted_at and hides from list", () => {
    const note = fixtureNote();
    softDeleteVaultNote(note.id);
    expect(listVaultNotes(10)).toHaveLength(0);
    expect(getVaultNoteById(note.id)?.deleted_at).not.toBeNull();
  });

  it("hardDeleteVaultNote removes the row entirely", () => {
    const note = fixtureNote();
    hardDeleteVaultNote(note.id);
    expect(getVaultNoteById(note.id)).toBeNull();
  });

  it("updateFtsRow + searchVaultNotes returns a hit with snippet", () => {
    const note = fixtureNote({ title: "Tokyo reel ideas" });
    updateFtsRow({ note_id: note.id, title: note.title, plain_text: "Some thoughts about tokyo travel content", tags: "reels tokyo" });
    const hits = searchVaultNotes("tokyo");
    expect(hits).toHaveLength(1);
    expect(hits[0].note.id).toBe(note.id);
    expect(hits[0].snippet).toContain("tokyo");
  });

  it("deleteFtsRow removes the FTS entry", () => {
    const note = fixtureNote({ title: "Tokyo reel" });
    updateFtsRow({ note_id: note.id, title: note.title, plain_text: "body", tags: "" });
    deleteFtsRow(note.id);
    expect(searchVaultNotes("tokyo")).toHaveLength(0);
  });

  it("listUncategorizedVaultNotes returns only notes with no bin", () => {
    const a = fixtureNote({ vault_path: "a.md" });
    const b = fixtureNote({ vault_path: "b.md" });
    const db = resetDbForTesting(TEST_DB);
    db.prepare("INSERT INTO bins (id, name, created_at) VALUES ('bin1', 'Bin One', '2026-04-23T10:00:00Z')").run();
    db.prepare(
      "INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, 'bin1', '2026-04-23T10:00:00Z', 'manual')"
    ).run(a.id);
    const uncat = listUncategorizedVaultNotes();
    expect(uncat).toHaveLength(1);
    expect(uncat[0].id).toBe(b.id);
  });
});
