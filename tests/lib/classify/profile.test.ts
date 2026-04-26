import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../lib/db";
import { setSetting } from "../../../lib/queries/app-settings";
import { resolveClassifyProfileId } from "../../../lib/classify/profile";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classify-profile.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
}

describe("resolveClassifyProfileId", () => {
  beforeEach(init);
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns classify.profile_id when set", () => {
    setSetting("classify.profile_id", "p-classify-1");
    setSetting("llm.active_profile_id", "p-chat-1");
    expect(resolveClassifyProfileId()).toBe("p-classify-1");
  });

  it("falls back to llm.active_profile_id when classify.profile_id unset", () => {
    setSetting("llm.active_profile_id", "p-chat-2");
    expect(resolveClassifyProfileId()).toBe("p-chat-2");
  });

  it("returns null when neither is set", () => {
    expect(resolveClassifyProfileId()).toBeNull();
  });
});
