import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  getSetting,
  setSetting,
  deleteSetting,
  getSettingJson,
  setSettingJson,
} from "../../../lib/queries/app-settings";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-app-settings.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("app-settings queries", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("setSetting + getSetting round-trip", () => {
    setSetting("k1", "v1");
    expect(getSetting("k1")).toBe("v1");
  });

  it("getSetting returns null for missing key", () => {
    expect(getSetting("nope")).toBeNull();
  });

  it("setSetting overwrites existing value", () => {
    setSetting("k1", "a");
    setSetting("k1", "b");
    expect(getSetting("k1")).toBe("b");
  });

  it("deleteSetting removes the key", () => {
    setSetting("k1", "v1");
    deleteSetting("k1");
    expect(getSetting("k1")).toBeNull();
  });

  it("setSettingJson + getSettingJson round-trip", () => {
    setSettingJson("notion.targets", ["db1", "db2"]);
    expect(getSettingJson<string[]>("notion.targets")).toEqual(["db1", "db2"]);
  });

  it("getSettingJson returns null for malformed JSON", () => {
    setSetting("bad.json", "not-valid-json");
    expect(getSettingJson("bad.json")).toBeNull();
  });

  it("getSettingJson returns null for missing key", () => {
    expect(getSettingJson("missing")).toBeNull();
  });
});
