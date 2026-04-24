import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { streamChatForProfile } from "../../../lib/llm/chat";
import { resetDbForTesting, closeDb } from "../../../lib/db";
import { createProfile } from "../../../lib/llm/profiles";
import fs from "fs";
import path from "path";
import os from "os";

vi.mock("../../../lib/llm/anthropic", () => ({
  makeAnthropicClient: vi.fn(() => "mock-anthropic-client"),
  streamAnthropic: vi.fn().mockImplementation(async function* () {
    yield { type: "text", text: "A" };
    yield { type: "done" };
  }),
}));

vi.mock("../../../lib/llm/openai-compat", () => ({
  makeOpenAiCompatClient: vi.fn(() => "mock-oai-client"),
  streamOpenAiCompat: vi.fn().mockImplementation(async function* () {
    yield { type: "text", text: "O" };
    yield { type: "done" };
  }),
}));

const TEST_DB = path.join(process.cwd(), "data", "test-llm-chat.db");
let TEST_HOME: string;

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("streamChatForProfile", () => {
  beforeEach(() => {
    initTestDb();
    TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "chat-test-"));
    process.env.HOME = TEST_HOME;
  });
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  it("routes anthropic profile to anthropic provider", async () => {
    const p = createProfile({
      name: "A",
      type: "anthropic",
      api_key: "k",
      default_model: "claude-opus-4-7",
    });
    const out: string[] = [];
    for await (const chunk of streamChatForProfile({
      profile: p,
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.type === "text") out.push(chunk.text);
    }
    expect(out.join("")).toBe("A");
  });

  it("routes openai-compatible profile to oai provider", async () => {
    const p = createProfile({
      name: "O",
      type: "openai-compatible",
      api_key: "k",
      base_url: "https://openrouter.ai/api/v1",
      default_model: "x/y",
    });
    const out: string[] = [];
    for await (const chunk of streamChatForProfile({
      profile: p,
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.type === "text") out.push(chunk.text);
    }
    expect(out.join("")).toBe("O");
  });

  it("throws if openai-compatible profile has no base_url", async () => {
    const p = createProfile({
      name: "Bad",
      type: "openai-compatible",
      api_key: "k",
      base_url: "",
      default_model: "x",
    });
    // Clear base_url after create
    p.base_url = undefined;
    await expect(async () => {
      for await (const _ of streamChatForProfile({
        profile: p,
        messages: [{ role: "user", content: "q" }],
      })) {
        void _;
      }
    }).rejects.toThrow(/base_url/);
  });
});
