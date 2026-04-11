import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../lib/db";
import { scanAgentConfigDir } from "../../scripts/sync-agents";
import { listAgents } from "../../lib/queries/agents";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-sync-agents.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
}

describe("sync-agents", () => {
  let tmpDir: string;

  beforeEach(() => {
    initTestDb();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-agents-"));
  });

  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers an agent from a config file", () => {
    const configPath = path.join(tmpDir, "weather-bot.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        name: "WeatherBot",
        type: "discord_bot",
        schedule: "0 7 * * *",
        status: "running",
        last_output: "Des Moines 72F",
      })
    );

    scanAgentConfigDir(tmpDir);
    const agents = listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("WeatherBot");
    expect(agents[0].type).toBe("discord_bot");
    expect(agents[0].last_output).toBe("Des Moines 72F");
  });

  it("ignores non-json files", () => {
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "hello");
    scanAgentConfigDir(tmpDir);
    expect(listAgents()).toHaveLength(0);
  });

  it("handles empty directory gracefully", () => {
    scanAgentConfigDir(tmpDir);
    expect(listAgents()).toHaveLength(0);
  });

  it("handles missing directory gracefully", () => {
    scanAgentConfigDir(path.join(tmpDir, "does-not-exist"));
    expect(listAgents()).toHaveLength(0);
  });
});
