import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { upsertNote, listNotes, listNotesByClient } from "../../../lib/queries/notes";
import { createClient } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-notes.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("note queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertNote inserts a new note", () => {
    const note = upsertNote({ title: "Strategy", source: "notion", source_url: "https://notion.so/x" });
    expect(note.title).toBe("Strategy");
  });

  it("upsertNote updates by source_url", () => {
    upsertNote({ title: "A", source: "notion", source_url: "https://notion.so/1", content_preview: "v1" });
    upsertNote({ title: "A", source: "notion", source_url: "https://notion.so/1", content_preview: "v2" });
    const all = listNotes();
    expect(all).toHaveLength(1);
    expect(all[0].content_preview).toBe("v2");
  });

  it("listNotesByClient filters correctly", () => {
    const c = createClient({ name: "Akoola" });
    upsertNote({ client_id: c.id, title: "A", source: "notion", source_url: "https://notion.so/a" });
    upsertNote({ title: "B", source: "notion", source_url: "https://notion.so/b" });
    expect(listNotesByClient(c.id)).toHaveLength(1);
  });
});
