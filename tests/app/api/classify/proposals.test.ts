import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDbForTesting, closeDb, getDb, migrate } from "../../../../lib/db";
import { PATCH } from "../../../../app/api/classify/proposals/[id]/route";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { createBin } from "../../../../lib/queries/bins";
import { insertProposal, insertClassifierRun } from "../../../../lib/queries/classifications";
import { nowIso } from "../../../../lib/utils";
import fs from "fs";
import path from "path";

const TEST_DB = path.join(process.cwd(), "data", "test-api-proposals.db");

function init(): void {
  closeDb();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = resetDbForTesting(TEST_DB);
  db.exec(fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8"));
  migrate(db);
}

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/classify/proposals/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setupProposal(): { proposalId: string; binId: string; noteId: string } {
  const bin = createBin({ name: "Travel" });
  const note = upsertVaultNote({
    vault_path: "note-a.md", title: "X", source: "obsidian",
    source_id: null, source_url: null, content_hash: "h", modified_at: nowIso(),
  });
  const runId = insertClassifierRun({ trigger: "manual" });
  const proposalId = insertProposal({
    note_id: note.id,
    proposed_existing_bin_id: bin.id,
    existing_confidence: 0.5,
    proposed_new_bin_path: null,
    new_bin_rating: null,
    no_fit_reasoning: null,
    reasoning: "test",
    model: "haiku",
    profile_id: "p1",
    run_id: runId,
  });
  return { proposalId, binId: bin.id, noteId: note.id };
}

describe("PATCH /api/classify/proposals/[id]", () => {
  beforeEach(init);
  afterEach(() => { closeDb(); if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB); });

  it("accept assigns the existing bin and removes the proposal", async () => {
    const { proposalId, binId, noteId } = setupProposal();
    const res = await PATCH(makeReq({ action: "accept" }), { params: { id: proposalId } });
    expect(res.status).toBe(200);
    const db = getDb();
    expect(db.prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?").get(noteId, binId)).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM classification_proposals WHERE id = ?").get(proposalId)).toBeUndefined();
  });

  it("reject increments classifier_attempts and removes the proposal", async () => {
    const { proposalId, noteId } = setupProposal();
    const res = await PATCH(makeReq({ action: "reject" }), { params: { id: proposalId } });
    expect(res.status).toBe(200);
    const db = getDb();
    const row = db.prepare("SELECT classifier_attempts FROM vault_notes WHERE id = ?").get(noteId) as { classifier_attempts: number };
    expect(row.classifier_attempts).toBe(1);
    expect(db.prepare("SELECT 1 FROM classification_proposals WHERE id = ?").get(proposalId)).toBeUndefined();
  });

  it("3 rejections set classifier_skip = 1", async () => {
    const { proposalId, noteId } = setupProposal();
    await PATCH(makeReq({ action: "reject" }), { params: { id: proposalId } });
    for (let i = 0; i < 2; i++) {
      const newProposalId = insertProposal({
        note_id: noteId, proposed_existing_bin_id: null, existing_confidence: 0.4,
        proposed_new_bin_path: null, new_bin_rating: null, no_fit_reasoning: null,
        reasoning: "r", model: "haiku", profile_id: "p1", run_id: insertClassifierRun({ trigger: "manual" }),
      });
      await PATCH(makeReq({ action: "reject" }), { params: { id: newProposalId } });
    }
    const db = getDb();
    const row = db.prepare("SELECT classifier_skip FROM vault_notes WHERE id = ?").get(noteId) as { classifier_skip: number };
    expect(row.classifier_skip).toBe(1);
  });

  it("accept-with-path creates a new bin chain and assigns it", async () => {
    const { proposalId, noteId } = setupProposal();
    const res = await PATCH(makeReq({ action: "accept_new_bin", path: "business/planning/okrs" }), { params: { id: proposalId } });
    expect(res.status).toBe(200);
    const db = getDb();
    const okrs = db.prepare("SELECT id FROM bins WHERE name = 'Okrs'").get() as { id: string };
    expect(okrs).toBeTruthy();
    const planning = db.prepare("SELECT id FROM bins WHERE name = 'Planning'").get();
    expect(planning).toBeTruthy();
    const business = db.prepare("SELECT id FROM bins WHERE name = 'Business'").get();
    expect(business).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ?").get(noteId, okrs.id)).toBeTruthy();
  });
});
