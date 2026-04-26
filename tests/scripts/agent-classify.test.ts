import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../lib/db";
import { upsertVaultNote } from "../../lib/queries/vault-notes";
import { createBin } from "../../lib/queries/bins";
import { nowIso } from "../../lib/utils";
import { runClassifierBatch } from "../../scripts/agent-classify";
import type { ClassifierLlm } from "../../lib/classify/run";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classifier-batch.db");
const TEST_VAULT = path.join(process.cwd(), "data", "test-vault-batch");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true });
  fs.mkdirSync(TEST_VAULT, { recursive: true });
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

function seed(name: string, body = "body"): string {
  const vaultPath = `${name}.md`;
  fs.writeFileSync(path.join(TEST_VAULT, vaultPath), body);
  const note = upsertVaultNote({
    vault_path: vaultPath, title: name, source: "obsidian",
    source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
  });
  return note.id;
}

function alwaysAssign(binPath: string): ClassifierLlm {
  return {
    modelName: "fake",
    complete: vi.fn(async () => JSON.stringify({
      existing_match: { bin_path: binPath, confidence: 0.9, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    })),
  };
}

describe("runClassifierBatch", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true }); });

  it("processes all unbinned notes up to the cap", async () => {
    createBin({ name: "Travel" });
    for (let i = 0; i < 5; i++) seed(`n-${i}`);
    const summary = await runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 2, rateLimitRpm: 100, cap: 10, vaultPath: TEST_VAULT });
    expect(summary.notes_seen).toBe(5);
    expect(summary.notes_auto_assigned).toBe(5);
    expect(summary.notes_pending).toBe(0);
  });

  it("aborts with ConcurrentRunError when a run is already in flight", async () => {
    createBin({ name: "Travel" });
    seed("n-1");
    const db = getDb();
    db.prepare("INSERT INTO classifier_runs (id, trigger, started_at) VALUES ('preexisting', 'cron', ?)").run(Date.now());
    await expect(
      runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 1, rateLimitRpm: 100, cap: 10, vaultPath: TEST_VAULT })
    ).rejects.toThrow(/already in flight/i);
  });

  it("respects the cap", async () => {
    createBin({ name: "Travel" });
    for (let i = 0; i < 12; i++) seed(`n-${i}`);
    const summary = await runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 3, rateLimitRpm: 100, cap: 5, vaultPath: TEST_VAULT });
    expect(summary.notes_seen).toBe(5);
  });

  it("skips notes flagged classifier_skip = 1", async () => {
    createBin({ name: "Travel" });
    const skipId = seed("note-skip");
    getDb().prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(skipId);
    seed("note-eligible");
    const summary = await runClassifierBatch({ trigger: "manual", llm: alwaysAssign("travel"), profileId: "p1", concurrency: 1, rateLimitRpm: 100, cap: 10, vaultPath: TEST_VAULT });
    expect(summary.notes_seen).toBe(1);
  });
});
