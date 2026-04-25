import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin } from "../../../../lib/queries/bins";
import { GET } from "../../../../app/api/bins/[id]/preview-delete/route";

const TEST_DB = path.join(process.cwd(), "data", "test-preview-delete.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("GET /api/bins/[id]/preview-delete", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns counts for a bin with children", async () => {
    const root = createBin({ name: "Root" });
    createBin({ name: "alpha", parent_bin_id: root.id });
    createBin({ name: "bravo", parent_bin_id: root.id });
    const res = await GET(new Request("http://x"), { params: { id: root.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.child_bin_count).toBe(2);
    expect(body.child_bin_names).toEqual(["alpha", "bravo"]);
    expect(body.has_more_children).toBe(false);
    expect(body.note_count).toBe(0);
  });

  it("returns 404 for missing bin", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});
