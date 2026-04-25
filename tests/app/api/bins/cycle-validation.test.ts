import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, getBinById } from "../../../../lib/queries/bins";
import { PATCH } from "../../../../app/api/bins/[id]/route";

const TEST_DB = path.join(process.cwd(), "data", "test-cycle.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("PATCH /api/bins/[id] cycle validation", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("rejects setting parent to self with 400", async () => {
    const a = createBin({ name: "A" });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ parent_bin_id: a.id }) });
    const res = await PATCH(req, { params: { id: a.id } });
    expect(res.status).toBe(400);
    expect(getBinById(a.id)?.parent_bin_id).toBeNull();
  });

  it("rejects setting parent to a descendant with 400", async () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B", parent_bin_id: a.id });
    const c = createBin({ name: "C", parent_bin_id: b.id });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ parent_bin_id: c.id }) });
    const res = await PATCH(req, { params: { id: a.id } });
    expect(res.status).toBe(400);
  });

  it("allows setting parent to an unrelated bin", async () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ parent_bin_id: b.id }) });
    const res = await PATCH(req, { params: { id: a.id } });
    expect(res.status).toBe(200);
    expect(getBinById(a.id)?.parent_bin_id).toBe(b.id);
  });
});
