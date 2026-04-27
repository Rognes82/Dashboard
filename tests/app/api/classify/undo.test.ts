import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../../lib/db";
import { POST } from "../../../../app/api/classify/auto/[id]/undo/route";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { createBin, assignNoteToBin } from "../../../../lib/queries/bins";
import { insertLogRow, insertClassifierRun } from "../../../../lib/queries/classifications";
import { nowIso } from "../../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-undo.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

describe("POST /api/classify/auto/[id]/undo", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("removes the assignment and writes 'undone' row", async () => {
    const note = upsertVaultNote({
      vault_path: "note-a.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    const bin = createBin({ name: "Travel" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "agent" });
    const runId = insertClassifierRun({ trigger: "manual" });
    const logId = insertLogRow({
      note_id: note.id, action: "auto_assign", bin_id: bin.id, new_bin_path: null,
      existing_confidence: 0.9, new_bin_rating: null, reasoning: "r", model: "haiku",
      profile_id: "p1", run_id: runId, prior_log_id: null,
    });
    const res = await POST(new Request("http://localhost/", { method: "POST" }), { params: { id: logId } });
    expect(res.status).toBe(200);
    const db = getDb();
    expect(db.prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?").get(note.id, bin.id)).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM classification_log WHERE action = 'undone' AND prior_log_id = ?").get(logId)).toBeTruthy();
  });

  it("does not count undo as a rejected classifier attempt", async () => {
    const note = upsertVaultNote({
      vault_path: "note-attempts.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    const bin = createBin({ name: "Travel" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "agent" });
    const runId = insertClassifierRun({ trigger: "manual" });
    const logId = insertLogRow({
      note_id: note.id, action: "auto_assign", bin_id: bin.id, new_bin_path: null,
      existing_confidence: 0.9, new_bin_rating: null, reasoning: "r", model: "haiku",
      profile_id: "p1", run_id: runId, prior_log_id: null,
    });

    const res = await POST(new Request("http://localhost/", { method: "POST" }), { params: { id: logId } });

    expect(res.status).toBe(200);
    const row = getDb()
      .prepare("SELECT classifier_attempts, classifier_skip FROM vault_notes WHERE id = ?")
      .get(note.id) as { classifier_attempts: number; classifier_skip: number };
    expect(row.classifier_attempts).toBe(0);
    expect(row.classifier_skip).toBe(0);
  });

  it("deletes auto-created bin if empty after undo", async () => {
    const note = upsertVaultNote({
      vault_path: "note-b.md", title: "X", source: "obsidian",
      source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
    });
    const bin = createBin({ name: "AutoBin" });
    assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "agent" });
    const runId = insertClassifierRun({ trigger: "manual" });
    const logId = insertLogRow({
      note_id: note.id, action: "auto_create_bin", bin_id: bin.id, new_bin_path: "auto-bin",
      existing_confidence: null, new_bin_rating: 0.85, reasoning: "r", model: "haiku",
      profile_id: "p1", run_id: runId, prior_log_id: null,
    });
    await POST(new Request("http://localhost/", { method: "POST" }), { params: { id: logId } });
    const db = getDb();
    expect(db.prepare("SELECT 1 FROM bins WHERE id = ?").get(bin.id)).toBeUndefined();
  });
});
