import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, assignNoteToBin, listBinsForNote } from "../../../../lib/queries/bins";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { nowIso } from "../../../../lib/utils";
import { POST } from "../../../../app/api/notes/[id]/move/route";

const TEST_DB = path.join(process.cwd(), "data", "test-move-note.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("POST /api/notes/[id]/move", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("moves a note from source bin to target bin (200)", async () => {
    const note = upsertVaultNote({
      vault_path: "x.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    assignNoteToBin({ note_id: note.id, bin_id: a.id, assigned_by: "manual" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ from_bin_id: a.id, to_bin_id: b.id }) });
    const res = await POST(req, { params: { id: note.id } });
    expect(res.status).toBe(200);
    const ids = listBinsForNote(note.id).map((x) => x.id);
    expect(ids).toEqual([b.id]);
  });

  it("returns 400 if note is not in source bin", async () => {
    const note = upsertVaultNote({
      vault_path: "y.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ from_bin_id: a.id, to_bin_id: b.id }) });
    const res = await POST(req, { params: { id: note.id } });
    expect(res.status).toBe(400);
  });

  it("returns 404 if a bin is missing", async () => {
    const note = upsertVaultNote({
      vault_path: "z.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    assignNoteToBin({ note_id: note.id, bin_id: a.id, assigned_by: "manual" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ from_bin_id: a.id, to_bin_id: "missing" }) });
    const res = await POST(req, { params: { id: note.id } });
    expect(res.status).toBe(404);
  });
});
