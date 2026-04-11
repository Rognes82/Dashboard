import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { recordActivity, listRecentActivity, listActivityByClient } from "../../../lib/queries/activity";
import { createClient } from "../../../lib/queries/clients";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-activity.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("activity queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("recordActivity inserts an entry", () => {
    const e = recordActivity({ source: "git", event_type: "commit", title: "Initial commit" });
    expect(e.title).toBe("Initial commit");
  });

  it("listRecentActivity returns entries newest first", () => {
    recordActivity({ source: "git", event_type: "commit", title: "old", timestamp: "2026-04-01T00:00:00Z" });
    recordActivity({ source: "git", event_type: "commit", title: "new", timestamp: "2026-04-10T00:00:00Z" });
    const all = listRecentActivity(10);
    expect(all[0].title).toBe("new");
  });

  it("listActivityByClient filters by client", () => {
    const c = createClient({ name: "Akoola" });
    recordActivity({ client_id: c.id, source: "git", event_type: "commit", title: "A" });
    recordActivity({ source: "system", event_type: "sync_error", title: "B" });
    expect(listActivityByClient(c.id)).toHaveLength(1);
  });
});
