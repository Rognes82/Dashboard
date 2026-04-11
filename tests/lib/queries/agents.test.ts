import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { upsertAgent, listAgents, getAgentByName } from "../../../lib/queries/agents";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-agents.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("agent queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("upsertAgent inserts and retrieves by name", () => {
    upsertAgent({ name: "WeatherBot", type: "discord_bot", status: "running" });
    const a = getAgentByName("WeatherBot");
    expect(a?.type).toBe("discord_bot");
  });

  it("upsertAgent updates existing agent", () => {
    upsertAgent({ name: "WeatherBot", type: "discord_bot", status: "running" });
    upsertAgent({ name: "WeatherBot", type: "discord_bot", status: "errored" });
    expect(getAgentByName("WeatherBot")?.status).toBe("errored");
    expect(listAgents()).toHaveLength(1);
  });
});
