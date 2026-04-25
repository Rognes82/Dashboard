import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, getBinById, getOrCreateBinBySeed } from "../../../../lib/queries/bins";
import { DELETE } from "../../../../app/api/bins/[id]/route";

const TEST_DB = path.join(process.cwd(), "data", "test-seeded-protect.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("DELETE /api/bins/[id] seeded-bin protection", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns 403 when deleting a seeded bin", async () => {
    const seeded = getOrCreateBinBySeed({ source_seed: "notion-sync", name: "Notion sync" });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: seeded.id } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/seeded/i);
    expect(getBinById(seeded.id)).not.toBeNull(); // still exists
  });

  it("allows deletion of non-seeded bins (sanity)", async () => {
    const bin = createBin({ name: "Regular" });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: bin.id } });
    expect(res.status).toBe(200);
    expect(getBinById(bin.id)).toBeNull();
  });

  it("returns 404 for missing bin", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});
