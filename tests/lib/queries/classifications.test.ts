import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../lib/db";
import {
  insertClassifierRun,
  finishClassifierRun,
  countInFlightRuns,
  insertProposal,
  insertLogRow,
  listPendingProposals,
  listRecentlyAutoClassified,
  acceptProposal,
  rejectProposal,
  undoAutoClassification,
  setClassifierSkip,
  acquireRunLock,
  ConcurrentRunError,
} from "../../../lib/queries/classifications";
import { createBin, assignNoteToBin } from "../../../lib/queries/bins";
import { upsertVaultNote } from "../../../lib/queries/vault-notes";
import { nowIso } from "../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-classifications.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
  migrate(db);
}

function seedNote(slug = "note-a"): string {
  const note = upsertVaultNote({
    vault_path: `${slug}.md`,
    title: slug,
    source: "obsidian",
    source_id: null,
    source_url: null,
    content_hash: "h",
    modified_at: nowIso(),
  });
  return note.id;
}

describe("classifier_runs", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("inserts a run row", () => {
    const id = insertClassifierRun({ trigger: "manual" });
    expect(id).toBeTruthy();
    const inFlight = countInFlightRuns();
    expect(inFlight).toBe(1);
  });

  it("acquireRunLock succeeds when no in-flight run", () => {
    const id = acquireRunLock("manual");
    expect(id).toBeTruthy();
  });

  it("acquireRunLock throws ConcurrentRunError when one in flight", () => {
    acquireRunLock("manual");
    expect(() => acquireRunLock("cron")).toThrow(ConcurrentRunError);
  });

  it("acquireRunLock sweeps orphan rows older than 30 minutes", () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO classifier_runs (id, trigger, started_at) VALUES (?, ?, ?)"
    ).run("orphan-1", "cron", Date.now() - 31 * 60_000);
    expect(() => acquireRunLock("manual")).not.toThrow();
    const orphan = db.prepare("SELECT finished_at, error_message FROM classifier_runs WHERE id = 'orphan-1'").get() as {
      finished_at: number;
      error_message: string;
    };
    expect(orphan.finished_at).toBeTruthy();
    expect(orphan.error_message).toBe("orphan_recovered");
  });

  it("finishClassifierRun updates row", () => {
    const id = insertClassifierRun({ trigger: "manual" });
    finishClassifierRun(id, { notes_seen: 5, notes_auto_assigned: 3, notes_auto_created: 1, notes_pending: 1, notes_errored: 0 });
    expect(countInFlightRuns()).toBe(0);
  });
});

describe("proposals + log", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("insertProposal then listPendingProposals returns it", () => {
    const noteId = seedNote("note-a");
    const bin = createBin({ name: "Travel" });
    const runId = insertClassifierRun({ trigger: "manual" });
    insertProposal({
      note_id: noteId,
      proposed_existing_bin_id: bin.id,
      existing_confidence: 0.5,
      proposed_new_bin_path: null,
      new_bin_rating: null,
      no_fit_reasoning: null,
      reasoning: "test",
      model: "haiku",
      profile_id: "p-1",
      run_id: runId,
    });
    const pending = listPendingProposals();
    expect(pending.length).toBe(1);
    expect(pending[0].note_id).toBe(noteId);
  });

  it("listRecentlyAutoClassified excludes notes with newer 'undone' rows", () => {
    const noteId = seedNote("note-a");
    const bin = createBin({ name: "Travel" });
    const runId = insertClassifierRun({ trigger: "manual" });
    const t = Date.now();
    insertLogRow({
      action: "auto_assign",
      note_id: noteId,
      bin_id: bin.id,
      new_bin_path: null,
      existing_confidence: 0.9,
      new_bin_rating: null,
      reasoning: "r",
      model: "haiku",
      profile_id: "p-1",
      run_id: runId,
      prior_log_id: null,
      created_at: t,
    });
    expect(listRecentlyAutoClassified().length).toBe(1);
    insertLogRow({
      action: "undone",
      note_id: noteId,
      bin_id: bin.id,
      new_bin_path: null,
      existing_confidence: null,
      new_bin_rating: null,
      reasoning: null,
      model: null,
      profile_id: null,
      run_id: runId,
      prior_log_id: null,
      created_at: t + 1000,
    });
    expect(listRecentlyAutoClassified().length).toBe(0);
  });
});

describe("setClassifierSkip", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("toggles classifier_skip flag", () => {
    const noteId = seedNote("note-a");
    setClassifierSkip(noteId, true);
    const db = getDb();
    const row = db.prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(noteId) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(1);
    setClassifierSkip(noteId, false);
    const row2 = db.prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(noteId) as { classifier_skip: number };
    expect(row2.classifier_skip).toBe(0);
  });
});
