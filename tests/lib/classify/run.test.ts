import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../lib/db";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import { createBin } from "../../../lib/queries/bins";
import { insertClassifierRun } from "../../../lib/queries/classifications";
import { nowIso } from "../../../lib/utils";
import { runClassifyOnce } from "../../../lib/classify/run";
import type { ClassifierLlm } from "../../../lib/classify/run";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classify-run.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
  // Seed the classifier run referenced by FKs in proposals/log inserts.
  insertClassifierRun({ trigger: "manual", id: "r1" });
}

function seedNote(slug: string, title: string): string {
  const note = upsertVaultNote({
    vault_path: `${slug}.md`, title, source: "obsidian",
    source_id: null, source_url: null,
    content_hash: "h", modified_at: nowIso(),
  });
  return note.id;
}

function fakeLlm(response: string): ClassifierLlm {
  return { complete: vi.fn(async () => response), modelName: "fake-haiku" };
}

describe("runClassifyOnce", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("auto-assigns a note when LLM is confident on existing bin", async () => {
    const bin = createBin({ name: "Travel" });
    const noteId = seedNote("note-a", "Tokyo trip");
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "travel", confidence: 0.9, reasoning: "Travel-related" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Tokyo trip", frontmatter: {}, body: "Trip notes" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("auto_assign");
    const db = getDb();
    const assignment = db.prepare("SELECT * FROM note_bins WHERE note_id = ? AND bin_id = ?").get(noteId, bin.id);
    expect(assignment).toBeTruthy();
    const log = db.prepare("SELECT * FROM classification_log WHERE note_id = ?").all(noteId);
    expect(log.length).toBe(1);
    expect((log[0] as { action: string }).action).toBe("auto_assign");
  });

  it("auto-creates a bin when gates pass", async () => {
    const parent = createBin({ name: "Business" });
    createBin({ name: "Planning", parent_bin_id: parent.id });
    const noteId = seedNote("note-okrs", "Q3 OKRs");
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "business", confidence: 0.3, reasoning: "loose" },
      proposed_new_bin: { path: "business/planning/okrs", rating: 0.85, reasoning: "OKRs doc" },
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Q3 OKRs", frontmatter: {}, body: "OKRs" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("auto_create_bin");
    const db = getDb();
    const newBin = db.prepare("SELECT id, name FROM bins WHERE name = 'Okrs'").get() as { id: string; name: string } | undefined;
    expect(newBin).toBeTruthy();
  });

  it("converts to auto_assign at commit if another note already created the bin", async () => {
    const parent = createBin({ name: "Business" });
    createBin({ name: "Planning", parent_bin_id: parent.id });
    const noteId = seedNote("note-okrs2", "Q3 OKRs");
    // pre-create the bin to simulate concurrent commit
    const planning = (getDb().prepare("SELECT id FROM bins WHERE name = 'Planning'").get() as { id: string }).id;
    createBin({ name: "Okrs", parent_bin_id: planning });
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "business", confidence: 0.3, reasoning: "loose" },
      proposed_new_bin: { path: "business/planning/okrs", rating: 0.85, reasoning: "OKRs doc" },
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Q3 OKRs", frontmatter: {}, body: "OKRs" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("auto_assign");
    const db = getDb();
    const okrsBins = db.prepare("SELECT COUNT(*) as n FROM bins WHERE name = 'Okrs'").get() as { n: number };
    expect(okrsBins.n).toBe(1);
  });

  it("queues pending when gates fail", async () => {
    createBin({ name: "Travel" });
    const noteId = seedNote("note-vague", "Vague note");
    const llm = fakeLlm(JSON.stringify({
      existing_match: { bin_path: "travel", confidence: 0.4, reasoning: "weak" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    }));
    const result = await runClassifyOnce({ note: { id: noteId, title: "Vague", frontmatter: {}, body: "x" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("pending");
    const db = getDb();
    const pending = db.prepare("SELECT * FROM classification_proposals WHERE note_id = ?").get(noteId);
    expect(pending).toBeTruthy();
  });

  it("retries once on malformed JSON, then logs error", async () => {
    createBin({ name: "Travel" });
    const noteId = seedNote("note-bad", "X");
    const llm: ClassifierLlm = { complete: vi.fn().mockResolvedValueOnce("not json").mockResolvedValueOnce("still not json"), modelName: "fake" };
    const result = await runClassifyOnce({ note: { id: noteId, title: "X", frontmatter: {}, body: "x" }, llm, runId: "r1", profileId: "p1" });
    expect(result.action).toBe("error");
    expect(llm.complete).toHaveBeenCalledTimes(2);
    const db = getDb();
    const errLog = db.prepare("SELECT * FROM classification_log WHERE note_id = ? AND action = 'error'").get(noteId);
    expect(errLog).toBeTruthy();
  });
});
