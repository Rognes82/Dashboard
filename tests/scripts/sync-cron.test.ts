import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { parseCrontab } from "../../scripts/sync-cron";
import { listAgents } from "../../lib/queries/agents";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-cron.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("sync-cron", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("parses crontab entries into agents", () => {
    const crontab = `# Comment
*/5 * * * * /usr/bin/python3 /opt/sync-projects.py
0 6 * * * /usr/bin/morning-forecast.sh`;
    parseCrontab(crontab);
    const agents = listAgents();
    expect(agents).toHaveLength(2);
    expect(agents[0].type).toBe("cron");
    expect(agents[0].schedule).toBeTruthy();
  });

  it("skips comment and empty lines", () => {
    const crontab = "# header\n\n# another comment\n";
    parseCrontab(crontab);
    expect(listAgents()).toHaveLength(0);
  });

  it("generates stable names from command", () => {
    const crontab = "*/5 * * * * /opt/sync-projects.py";
    parseCrontab(crontab);
    parseCrontab(crontab);
    expect(listAgents()).toHaveLength(1);
  });
});
