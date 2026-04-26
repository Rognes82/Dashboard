import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, getBinById } from "../../../../lib/queries/bins";
import { PATCH } from "../../../../app/api/bins/[id]/route";

const TEST_DB = path.join(process.cwd(), "data", "test-sort-renumber.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("PATCH /api/bins/[id] sort_order renumber", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("PATCH with sort_order routes through updateBinSortOrder and triggers renumber on collapse", async () => {
    const a = createBin({ name: "A", sort_order: 1000 });
    const b = createBin({ name: "B", sort_order: 1000.00000005 });
    const c = createBin({ name: "C", sort_order: 1000.0000001 });

    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ sort_order: 1000.00000006 }),
    });
    const res = await PATCH(req, { params: { id: b.id } });
    expect(res.status).toBe(200);

    // Renumber should have fired
    expect(getBinById(a.id)?.sort_order).toBe(1000);
    expect(getBinById(b.id)?.sort_order).toBe(2000);
    expect(getBinById(c.id)?.sort_order).toBe(3000);
  });

  it("PATCH with name only does not route through updateBinSortOrder (sort_order untouched)", async () => {
    const a = createBin({ name: "A", sort_order: 500 });
    const req = new Request("http://x", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
    });
    const res = await PATCH(req, { params: { id: a.id } });
    expect(res.status).toBe(200);
    expect(getBinById(a.id)?.name).toBe("Renamed");
    expect(getBinById(a.id)?.sort_order).toBe(500);
  });
});
