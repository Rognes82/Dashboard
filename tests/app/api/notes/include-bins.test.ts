import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { createBin, assignNoteToBin } from "../../../../lib/queries/bins";
import { nowIso } from "../../../../lib/utils";
import { GET } from "../../../../app/api/notes/route";

const TEST_DB = path.join(process.cwd(), "data", "test-include-bins.db");

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

describe("GET /api/notes ?include=bins", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("without ?include=bins, response has no bins field per note", async () => {
    fixtureNote("a.md");
    const res = await GET(new Request("http://x/api/notes?limit=100"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].bins).toBeUndefined();
  });

  it("with ?include=bins, note in 0 bins gets bins: []", async () => {
    fixtureNote("a.md");
    const res = await GET(new Request("http://x/api/notes?include=bins&limit=100"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes[0].bins).toEqual([]);
  });

  it("with ?include=bins, note in 2 bins gets both bin ids", async () => {
    const note = fixtureNote("a.md");
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    assignNoteToBin({ note_id: note.id, bin_id: a.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: note.id, bin_id: b.id, assigned_by: "manual" });
    const res = await GET(new Request("http://x/api/notes?include=bins&limit=100"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes[0].bins).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(body.notes[0].bins).toHaveLength(2);
  });
});
