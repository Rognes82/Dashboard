import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../../lib/db";
import { PATCH } from "../../../../app/api/notes/[id]/classifier-skip/route";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { nowIso } from "../../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-skip.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

describe("PATCH /api/notes/[id]/classifier-skip", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("sets classifier_skip = 1 when skip:true", async () => {
    const note = upsertVaultNote({
      vault_path: "note-a.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    const req = new Request("http://localhost/", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skip: true }) });
    const res = await PATCH(req, { params: { id: note.id } });
    expect(res.status).toBe(200);
    const row = getDb().prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(note.id) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(1);
  });

  it("sets classifier_skip = 0 when skip:false", async () => {
    const note = upsertVaultNote({
      vault_path: "note-a.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    getDb().prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(note.id);
    const req = new Request("http://localhost/", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skip: false }) });
    await PATCH(req, { params: { id: note.id } });
    const row = getDb().prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(note.id) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(0);
  });
});
