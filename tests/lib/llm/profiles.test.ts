import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getActiveProfile,
  setActiveProfile,
  getProfileSecret,
  runMigrationFromEnv,
} from "../../../lib/llm/profiles";
import fs from "fs";
import path from "path";
import os from "os";

const TEST_DB = path.join(process.cwd(), "data", "test-llm-profiles.db");
let TEST_HOME: string;

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("llm profiles", () => {
  beforeEach(() => {
    initTestDb();
    TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "llm-profile-test-"));
    process.env.HOME = TEST_HOME;
    delete process.env.ANTHROPIC_API_KEY;
  });
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("createProfile stores an encrypted key + getProfileSecret decrypts", () => {
    const p = createProfile({
      name: "Anthropic",
      type: "anthropic",
      api_key: "sk-ant-raw-key",
      default_model: "claude-opus-4-7",
    });
    expect(p.id).toHaveLength(26);
    expect(p.api_key_encrypted).not.toContain("sk-ant");
    expect(p.max_context_tokens).toBe(200_000);
    expect(getProfileSecret(p.id)).toBe("sk-ant-raw-key");
  });

  it("listProfiles returns newest first", () => {
    createProfile({ name: "A", type: "anthropic", api_key: "a", default_model: "claude-opus-4-7" });
    createProfile({ name: "B", type: "anthropic", api_key: "b", default_model: "claude-opus-4-7" });
    const profiles = listProfiles();
    expect(profiles.map((p) => p.name)).toEqual(["B", "A"]);
  });

  it("createProfile uses 128_000 default max_context_tokens for openai-compatible", () => {
    const p = createProfile({
      name: "OR",
      type: "openai-compatible",
      api_key: "key",
      base_url: "https://openrouter.ai/api/v1",
      default_model: "anthropic/claude-sonnet-4-6",
    });
    expect(p.max_context_tokens).toBe(128_000);
  });

  it("createProfile respects explicit max_context_tokens override", () => {
    const p = createProfile({
      name: "Local",
      type: "openai-compatible",
      api_key: "key",
      base_url: "http://localhost:1234/v1",
      default_model: "llama-3.3-70b",
      max_context_tokens: 32_000,
    });
    expect(p.max_context_tokens).toBe(32_000);
  });

  it("updateProfile patches name + default_model, preserves id", () => {
    const p = createProfile({ name: "Old", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    const updated = updateProfile(p.id, { name: "New", default_model: "claude-sonnet-4-6" });
    expect(updated!.id).toBe(p.id);
    expect(updated!.name).toBe("New");
    expect(updated!.default_model).toBe("claude-sonnet-4-6");
  });

  it("updateProfile with api_key re-encrypts", () => {
    const p = createProfile({ name: "P", type: "anthropic", api_key: "v1", default_model: "claude-opus-4-7" });
    updateProfile(p.id, { api_key: "v2" });
    expect(getProfileSecret(p.id)).toBe("v2");
  });

  it("deleteProfile removes it + clears active if it was active", () => {
    const p = createProfile({ name: "P", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    setActiveProfile(p.id);
    expect(getActiveProfile()?.id).toBe(p.id);
    deleteProfile(p.id);
    expect(listProfiles()).toHaveLength(0);
    expect(getActiveProfile()).toBeNull();
  });

  it("setActiveProfile sets the active id; getActiveProfile returns it", () => {
    const a = createProfile({ name: "A", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    const b = createProfile({ name: "B", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    setActiveProfile(b.id);
    expect(getActiveProfile()?.id).toBe(b.id);
    setActiveProfile(a.id);
    expect(getActiveProfile()?.id).toBe(a.id);
  });

  it("getActiveProfile returns null when no profiles exist", () => {
    expect(getActiveProfile()).toBeNull();
  });

  it("runMigrationFromEnv creates a default profile from ANTHROPIC_API_KEY and marks it active", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
    runMigrationFromEnv();
    const profiles = listProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Claude direct");
    expect(profiles[0].default_model).toBe("claude-opus-4-7");
    expect(profiles[0].max_context_tokens).toBe(200_000);
    expect(getActiveProfile()?.id).toBe(profiles[0].id);
    expect(getProfileSecret(profiles[0].id)).toBe("sk-ant-from-env");
  });

  it("runMigrationFromEnv is a no-op when profiles already exist", () => {
    createProfile({ name: "Existing", type: "anthropic", api_key: "k", default_model: "claude-opus-4-7" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-new";
    runMigrationFromEnv();
    expect(listProfiles()).toHaveLength(1);
    expect(listProfiles()[0].name).toBe("Existing");
  });

  it("runMigrationFromEnv is a no-op when ANTHROPIC_API_KEY is unset", () => {
    delete process.env.ANTHROPIC_API_KEY;
    runMigrationFromEnv();
    expect(listProfiles()).toHaveLength(0);
  });
});
