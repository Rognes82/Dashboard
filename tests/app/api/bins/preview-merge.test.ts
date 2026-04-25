import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, assignNoteToBin } from "../../../../lib/queries/bins";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { nowIso } from "../../../../lib/utils";
import { GET } from "../../../../app/api/bins/[id]/preview-merge/route";

const TEST_DB = path.join(process.cwd(), "data", "test-preview-merge.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("GET /api/bins/[id]/preview-merge", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns direct child + note counts", async () => {
    const root = createBin({ name: "Root" });
    const child = createBin({ name: "Child", parent_bin_id: root.id });
    createBin({ name: "Grand", parent_bin_id: child.id });
    const note = upsertVaultNote({
      vault_path: "p.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    assignNoteToBin({ note_id: note.id, bin_id: root.id, assigned_by: "manual" });
    const res = await GET(new Request("http://x"), { params: { id: root.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.direct_child_count).toBe(1); // Grand is NOT counted
    expect(body.direct_note_count).toBe(1);
  });

  it("returns 404 for missing bin", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});
