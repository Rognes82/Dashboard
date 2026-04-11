import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { upsertFile, listFiles, listFilesByClient } from "../../../lib/queries/files";
import { createClient } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-files.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("file queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertFile inserts a new file", () => {
    const file = upsertFile({ name: "doc.pdf", path: "/a/doc.pdf", source: "local" });
    expect(file.name).toBe("doc.pdf");
    expect(file.source).toBe("local");
  });

  it("upsertFile updates existing file by path", () => {
    upsertFile({ name: "doc.pdf", path: "/a/doc.pdf", source: "local", size: 100 });
    upsertFile({ name: "doc.pdf", path: "/a/doc.pdf", source: "local", size: 200 });
    const all = listFiles();
    expect(all).toHaveLength(1);
    expect(all[0].size).toBe(200);
  });

  it("listFilesByClient returns only linked files", () => {
    const c = createClient({ name: "Akoola" });
    upsertFile({ client_id: c.id, name: "a.pdf", path: "/a.pdf", source: "local" });
    upsertFile({ name: "b.pdf", path: "/b.pdf", source: "local" });
    expect(listFilesByClient(c.id)).toHaveLength(1);
  });
});
