import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { runSyncNotion, type NotionSyncDeps, type SyncNotionPage } from "../../scripts/sync-notion";
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

/**
 * Build a fake client keyed by page_id. Pass `throwOn` to simulate a failing
 * retrieve for specific IDs.
 */
function fakeClient(options: {
  pages: Record<string, SyncNotionPage>;
  throwOn?: Set<string>;
}): NotionSyncDeps["client"] {
  return {
    async getPage(id: string): Promise<SyncNotionPage> {
      if (options.throwOn?.has(id)) {
        throw new Error(`simulated failure for ${id}`);
      }
      const p = options.pages[id];
      if (!p) throw new Error(`unknown page ${id}`);
      return p;
    },
  };
}

describe("sync-notion", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("pulls a configured page and writes a markdown file", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["page-1"]);
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        pages: {
          "page-1": {
            id: "page-1",
            url: "https://notion.so/p1",
            title: "First Meeting",
            last_edited_time: "2026-04-23T10:00:00Z",
            markdown: "# First Meeting\n\nNotes here.",
          },
        },
      }),
    });

    const row = getVaultNoteBySourceId("page-1");
    expect(row).not.toBeNull();
    expect(row?.source).toBe("notion");
    expect(row?.vault_path).toBe(`notion-sync/${slugify("First Meeting")}.md`);

    const onDisk = fs.readFileSync(path.join(vault, row!.vault_path), "utf-8");
    expect(onDisk).toContain("source: notion");
    expect(onDisk).toContain("source_id: page-1");
    expect(onDisk).toContain("First Meeting");

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("skips pages unchanged since their cursor entry", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["page-old", "page-new"]);

    // First run: both pages present, get written.
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        pages: {
          "page-old": {
            id: "page-old",
            url: "https://notion.so/old",
            title: "Old Page",
            last_edited_time: "2026-04-20T00:00:00Z",
            markdown: "old body",
          },
          "page-new": {
            id: "page-new",
            url: "https://notion.so/new",
            title: "New Page",
            last_edited_time: "2026-04-24T12:00:00Z",
            markdown: "new body",
          },
        },
      }),
    });

    const firstOld = getVaultNoteBySourceId("page-old");
    const firstNew = getVaultNoteBySourceId("page-new");
    expect(firstOld).not.toBeNull();
    expect(firstNew).not.toBeNull();
    const firstOldSynced = firstOld!.last_indexed_at;
    const firstNewSynced = firstNew!.last_indexed_at;

    // Second run: old unchanged, new bumped.
    await new Promise((r) => setTimeout(r, 10)); // ensure nowIso() differs
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        pages: {
          "page-old": {
            id: "page-old",
            url: "https://notion.so/old",
            title: "Old Page",
            last_edited_time: "2026-04-20T00:00:00Z",
            markdown: "old body",
          },
          "page-new": {
            id: "page-new",
            url: "https://notion.so/new",
            title: "New Page",
            last_edited_time: "2026-04-25T12:00:00Z",
            markdown: "new body v2",
          },
        },
      }),
    });

    const notes = listVaultNotes(100);
    expect(notes).toHaveLength(2);

    const secondOld = getVaultNoteBySourceId("page-old");
    const secondNew = getVaultNoteBySourceId("page-new");

    // Old page: skipped (last_indexed_at unchanged)
    expect(secondOld!.last_indexed_at).toBe(firstOldSynced);
    // New page: re-synced (last_indexed_at bumped)
    expect(secondNew!.last_indexed_at).not.toBe(firstNewSynced);

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("handles page rename by renaming the file on disk and reusing the same row", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["page-1"]);

    // First sync
    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        pages: {
          "page-1": {
            id: "page-1",
            url: "https://notion.so/p1",
            title: "Original Title",
            last_edited_time: "2026-04-23T10:00:00Z",
            markdown: "body",
          },
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
        pages: {
          "page-1": {
            id: "page-1",
            url: "https://notion.so/p1",
            title: "Renamed Title",
            last_edited_time: "2026-04-24T10:00:00Z",
            markdown: "body",
          },
        },
      }),
    });

    const secondRow = getVaultNoteBySourceId("page-1");
    expect(secondRow!.id).toBe(firstRow!.id); // same DB row (upsert by source_id)
    expect(secondRow!.vault_path).not.toBe(firstPath); // path changed
    expect(fs.existsSync(path.join(vault, firstPath))).toBe(false); // old file gone
    expect(fs.existsSync(path.join(vault, secondRow!.vault_path))).toBe(true); // new file present

    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("appends -2 on slug collision across pages", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["p-a", "p-b"]);

    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        pages: {
          "p-a": {
            id: "p-a",
            url: "u",
            title: "Same Title",
            last_edited_time: "2026-04-23T10:00:00Z",
            markdown: "a",
          },
          "p-b": {
            id: "p-b",
            url: "u",
            title: "Same Title",
            last_edited_time: "2026-04-23T10:01:00Z",
            markdown: "b",
          },
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
      client: fakeClient({ pages: {} }),
    });
    expect(listVaultNotes(100)).toHaveLength(0);
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("continues past a failing page and preserves cursor for successful ones", async () => {
    const vault = tempVault();
    setSettingJson("notion.sync_targets", ["page-good", "page-bad", "page-also-good"]);

    await runSyncNotion({
      vaultPath: vault,
      client: fakeClient({
        pages: {
          "page-good": {
            id: "page-good",
            url: "https://notion.so/good",
            title: "Good Page",
            last_edited_time: "2026-04-24T09:00:00Z",
            markdown: "body",
          },
          "page-also-good": {
            id: "page-also-good",
            url: "https://notion.so/also-good",
            title: "Also Good Page",
            last_edited_time: "2026-04-24T09:00:00Z",
            markdown: "body",
          },
        },
        throwOn: new Set(["page-bad"]),
      }),
    });

    // Both good pages wrote
    expect(getVaultNoteBySourceId("page-good")).not.toBeNull();
    expect(getVaultNoteBySourceId("page-also-good")).not.toBeNull();
    expect(getVaultNoteBySourceId("page-bad")).toBeNull();

    // Sync status records "error" due to page-bad, but cursor reflects success for the others
    const { readSyncCursor, listSyncStatuses } = await import("../../lib/queries/sync-status");
    const status = listSyncStatuses().find((s) => s.sync_name === "sync-notion");
    expect(status?.status).toBe("error");
    expect(status?.error_message).toContain("page-bad");

    const cursorRaw = readSyncCursor("sync-notion");
    expect(cursorRaw).toBeTruthy();
    const cursor = JSON.parse(cursorRaw!);
    expect(cursor["page-good"]).toBe("2026-04-24T09:00:00Z");
    expect(cursor["page-also-good"]).toBe("2026-04-24T09:00:00Z");
    expect(cursor["page-bad"]).toBeUndefined();

    fs.rmSync(vault, { recursive: true, force: true });
  });
});
