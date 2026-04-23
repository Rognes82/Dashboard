import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { recordSyncRun, listSyncStatuses, readSyncCursor } from "../../../lib/queries/sync-status";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-status.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("sync_status queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("recordSyncRun inserts a new sync entry", () => {
    recordSyncRun({ sync_name: "sync-projects", status: "ok", duration_ms: 150 });
    const statuses = listSyncStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("ok");
  });

  it("recordSyncRun upserts by sync_name", () => {
    recordSyncRun({ sync_name: "sync-projects", status: "ok", duration_ms: 150 });
    recordSyncRun({ sync_name: "sync-projects", status: "error", error_message: "boom" });
    const statuses = listSyncStatuses();
    expect(statuses).toHaveLength(1);
    expect(statuses[0].status).toBe("error");
    expect(statuses[0].error_message).toBe("boom");
  });

  it("recordSyncRun persists and reads a cursor", () => {
    recordSyncRun({ sync_name: "notion", status: "ok", cursor: '{"db1":"2026-04-23T00:00:00Z"}' });
    const status = readSyncCursor("notion");
    expect(status).toBe('{"db1":"2026-04-23T00:00:00Z"}');
  });

  it("readSyncCursor returns null when no row exists", () => {
    expect(readSyncCursor("never-ran")).toBeNull();
  });
});
