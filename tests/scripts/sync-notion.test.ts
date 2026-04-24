import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { runSyncNotion, type NotionSyncDeps } from "../../scripts/sync-notion";
import { setSettingJson } from "../../lib/queries/app-settings";
import { getVaultNoteBySourceId, listVaultNotes } from "../../lib/queries/vault-notes";
import { slugify } from "../../lib/utils";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-notion.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

function tempVault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vault-notion-test-"));
}

function fakeClient(options: {
  database: { id: string; title: string };
  pagesByDb: Record<string, Array<{
    id: string;
    url: string;
    title: string;
    last_edited_time: string;
    blocks_markdown: string; // the markdown we want produced
  }>>;
}): NotionSyncDeps["client"] {
  return {
    async getDatabase(id: string) {
      if (id !== options.database.id) throw new Error("unknown db");
      return options.database;
    },
    async queryPages(db_id: string, since?: string) {
      const all = options.pagesByDb[db_id] ?? [];
      const filtered = since ? all.filter((p) => p.last_edited_time > since) : all;
      return filtered.map((p) => ({
        id: p.id,
        url: p.url,
        title: p.title,
        last_edited_time: p.last_edited_time,
        markdown: p.blocks_markdown,
      }));
    },
  };
}

describe("sync-notion", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("pulls pages from a configured database and writes markdown files", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "page-1",
              url: "https://notion.so/p1",
              title: "First Meeting",
              last_edited_time: "2026-04-23T10:00:00Z",
              blocks_markdown: "# First Meeting\n\nNotes here.",
            },
          ],
        },
      }),
    });

    const row = getVaultNoteBySourceId("page-1");
    expect(row).not.toBeNull();
    expect(row?.source).toBe("notion");
    expect(row?.vault_path).toBe(`notion-sync/${slugify("Meetings")}/${slugify("First Meeting")}.md`);

    const onDisk = fs.readFileSync(path.join(vault, row!.vault_path), "utf-8");
    expect(onDisk).toContain("source: notion");
    expect(onDisk).toContain("source_id: page-1");
    expect(onDisk).toContain("First Meeting");

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("skips pages older than the per-db cursor", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);

    // First run
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "old",
              url: "https://notion.so/old",
              title: "Old Page",
              last_edited_time: "2026-04-20T00:00:00Z",
              blocks_markdown: "old body",
            },
          ],
        },
      }),
    });

    // Second run with same old page + one new
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "old",
              url: "https://notion.so/old",
              title: "Old Page",
              last_edited_time: "2026-04-20T00:00:00Z",
              blocks_markdown: "old body",
            },
            {
              id: "new",
              url: "https://notion.so/new",
              title: "New Page",
              last_edited_time: "2026-04-24T12:00:00Z",
              blocks_markdown: "new body",
            },
          ],
        },
      }),
    });

    const notes = listVaultNotes(100);
    expect(notes).toHaveLength(2); // old + new, processed once each
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("handles page rename by renaming the file on disk and reusing the same row", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);

    // First sync
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "page-1",
              url: "https://notion.so/p1",
              title: "Original Title",
              last_edited_time: "2026-04-23T10:00:00Z",
              blocks_markdown: "body",
            },
          ],
        },
      }),
    });

    const firstRow = getVaultNoteBySourceId("page-1");
    const firstPath = firstRow!.vault_path;
    expect(fs.existsSync(path.join(vault, firstPath))).toBe(true);

    // Second sync with new title and a later timestamp
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Meetings" },
        pagesByDb: {
          db1: [
            {
              id: "page-1",
              url: "https://notion.so/p1",
              title: "Renamed Title",
              last_edited_time: "2026-04-24T10:00:00Z",
              blocks_markdown: "body",
            },
          ],
        },
      }),
    });

    const secondRow = getVaultNoteBySourceId("page-1");
    expect(secondRow!.id).toBe(firstRow!.id); // same DB row
    expect(secondRow!.vault_path).not.toBe(firstPath); // path changed
    expect(fs.existsSync(path.join(vault, firstPath))).toBe(false); // old file gone
    expect(fs.existsSync(path.join(vault, secondRow!.vault_path))).toBe(true); // new file present

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("appends -2 on slug collision within a database", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db1"]);

    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        database: { id: "db1", title: "Notes" },
        pagesByDb: {
          db1: [
            {
              id: "p-a",
              url: "u",
              title: "Same Title",
              last_edited_time: "2026-04-23T10:00:00Z",
              blocks_markdown: "a",
            },
            {
              id: "p-b",
              url: "u",
              title: "Same Title",
              last_edited_time: "2026-04-23T10:01:00Z",
              blocks_markdown: "b",
            },
          ],
        },
      }),
    });

    const a = getVaultNoteBySourceId("p-a");
    const b = getVaultNoteBySourceId("p-b");
    expect(a!.vault_path).not.toBe(b!.vault_path);
    expect([a!.vault_path, b!.vault_path].some((p) => p.endsWith("-2.md"))).toBe(true);

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("exits cleanly with no targets configured", async () => {
    const vault = tempVault();
    // No sync_targets set
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({ database: { id: "x", title: "x" }, pagesByDb: {} }),
    });
    expect(listVaultNotes(100)).toHaveLength(0);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("continues past a failing database and preserves cursor for successful ones", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["db-good", "db-bad", "db-also-good"]);

    const throwingClient = {
      async getDatabase(id: string) {
        if (id === "db-bad") throw new Error("simulated auth failure");
        return { id, title: id === "db-good" ? "Good" : "Also Good" };
      },
      async queryPages(db_id: string) {
        if (db_id === "db-bad") throw new Error("should never reach queryPages on bad");
        return [
          {
            id: `${db_id}-page-1`,
            url: `https://notion.so/${db_id}-1`,
            title: `${db_id} Page`,
            last_edited_time: "2026-04-24T09:00:00Z",
            markdown: "body",
          },
        ];
      },
    };

    await runSyncNotion({ vaultPath: vault, client: throwingClient });

    // Both good DBs wrote their page
    expect(getVaultNoteBySourceId("db-good-page-1")).not.toBeNull();
    expect(getVaultNoteBySourceId("db-also-good-page-1")).not.toBeNull();

    // Sync status records "error" due to db-bad, but cursor reflects success for the others
    const { readSyncCursor, listSyncStatuses } = await import("../../lib/queries/sync-status");
    const status = listSyncStatuses().find((s) => s.sync_name === "sync-notion");
    expect(status?.status).toBe("error");
    expect(status?.error_message).toContain("db-bad");

    const cursorRaw = readSyncCursor("sync-notion");
    expect(cursorRaw).toBeTruthy();
    const cursor = JSON.parse(cursorRaw!);
    expect(cursor["db-good"]).toBe("2026-04-24T09:00:00Z");
    expect(cursor["db-also-good"]).toBe("2026-04-24T09:00:00Z");
    expect(cursor["db-bad"]).toBeUndefined();

    fs.rmSync(vault, { recursive: true, force: true });
  });
});
