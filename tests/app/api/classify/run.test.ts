import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDbForTesting, closeDb, migrate } from "../../../../lib/db";
import { POST } from "../../../../app/api/classify/run/route";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-classify-run.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

vi.mock("../../../../scripts/agent-classify", () => ({
  runClassifierBatch: vi.fn(async () => ({
    notes_seen: 3,
    notes_auto_assigned: 2,
    notes_auto_created: 0,
    notes_pending: 1,
    notes_errored: 0,
    error_message: null,
  })),
}));

vi.mock("../../../../lib/classify/profile", () => ({
  resolveClassifyProfileId: vi.fn(() => "p1"),
}));

vi.mock("../../../../lib/llm/profiles", () => ({
  getProfile: vi.fn(() => ({
    id: "p1", name: "Haiku", type: "anthropic",
    default_model: "claude-haiku-4-5", api_key_encrypted: "x",
    max_context_tokens: 200000, created_at: "2026-01-01",
  })),
  getProfileSecret: vi.fn(() => "fake-key"),
}));

vi.mock("../../../../lib/classify/llm-adapter", () => ({
  buildClassifierLlm: vi.fn(() => ({ modelName: "fake", complete: vi.fn() })),
}));

describe("POST /api/classify/run", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("returns run summary on success", async () => {
    const res = await POST(new Request("http://localhost/api/classify/run", { method: "POST" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notes_seen).toBe(3);
    expect(body.notes_auto_assigned).toBe(2);
  });

  it("returns 503 when no profile is configured", async () => {
    const profile = await import("../../../../lib/classify/profile");
    vi.mocked(profile.resolveClassifyProfileId).mockReturnValueOnce(null);
    const res = await POST(new Request("http://localhost/api/classify/run", { method: "POST" }));
    expect(res.status).toBe(503);
  });
});
