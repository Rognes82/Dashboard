import { getDb } from "../db";
import { newId, slugify } from "../utils";

const ORPHAN_THRESHOLD_MS = 30 * 60_000;

export class ConcurrentRunError extends Error {
  constructor() {
    super("classifier run already in flight");
    this.name = "ConcurrentRunError";
  }
}

export function insertClassifierRun(params: { trigger: "cron" | "manual"; id?: string }): string {
  const id = params.id ?? newId();
  const db = getDb();
  db.prepare("INSERT INTO classifier_runs (id, trigger, started_at) VALUES (?, ?, ?)").run(id, params.trigger, Date.now());
  return id;
}

export function countInFlightRuns(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as n FROM classifier_runs WHERE finished_at IS NULL").get() as { n: number };
  return row.n;
}

export function acquireRunLock(trigger: "cron" | "manual"): string {
  const db = getDb();
  const id = newId();
  const now = Date.now();
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      "UPDATE classifier_runs SET finished_at = ?, error_message = 'orphan_recovered' WHERE finished_at IS NULL AND started_at < ?"
    ).run(now, now - ORPHAN_THRESHOLD_MS);
    const inFlight = db.prepare("SELECT COUNT(*) as n FROM classifier_runs WHERE finished_at IS NULL").get() as { n: number };
    if (inFlight.n > 0) {
      db.exec("ROLLBACK");
      throw new ConcurrentRunError();
    }
    db.prepare("INSERT INTO classifier_runs (id, trigger, started_at) VALUES (?, ?, ?)").run(id, trigger, now);
    db.exec("COMMIT");
    return id;
  } catch (e) {
    if (e instanceof ConcurrentRunError) throw e;
    if (e instanceof Error && /SQLITE_BUSY/i.test(e.message)) {
      throw new ConcurrentRunError();
    }
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
}

export interface ClassifierRunSummary {
  notes_seen: number;
  notes_auto_assigned: number;
  notes_auto_created: number;
  notes_pending: number;
  notes_errored: number;
  error_message?: string | null;
}

export function finishClassifierRun(id: string, summary: ClassifierRunSummary): void {
  const db = getDb();
  db.prepare(
    `UPDATE classifier_runs SET finished_at = ?, notes_seen = ?, notes_auto_assigned = ?,
     notes_auto_created = ?, notes_pending = ?, notes_errored = ?, error_message = ? WHERE id = ?`
  ).run(
    Date.now(),
    summary.notes_seen,
    summary.notes_auto_assigned,
    summary.notes_auto_created,
    summary.notes_pending,
    summary.notes_errored,
    summary.error_message ?? null,
    id,
  );
}

export interface ProposalInsert {
  id?: string;
  note_id: string;
  proposed_existing_bin_id: string | null;
  existing_confidence: number;
  proposed_new_bin_path: string | null;
  new_bin_rating: number | null;
  no_fit_reasoning: string | null;
  reasoning: string;
  model: string;
  profile_id: string;
  run_id: string;
}

export function insertProposal(p: ProposalInsert): string {
  const id = p.id ?? newId();
  const db = getDb();
  db.prepare(
    `INSERT INTO classification_proposals
     (id, note_id, proposed_existing_bin_id, existing_confidence, proposed_new_bin_path,
      new_bin_rating, no_fit_reasoning, reasoning, model, profile_id, run_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, p.note_id, p.proposed_existing_bin_id, p.existing_confidence, p.proposed_new_bin_path,
    p.new_bin_rating, p.no_fit_reasoning, p.reasoning, p.model, p.profile_id, p.run_id, Date.now(),
  );
  return id;
}

export interface LogRowInsert {
  id?: string;
  note_id: string | null;
  action: "auto_assign" | "auto_create_bin" | "pending" | "accepted" | "rejected" | "undone" | "error";
  bin_id: string | null;
  new_bin_path: string | null;
  existing_confidence: number | null;
  new_bin_rating: number | null;
  reasoning: string | null;
  model: string | null;
  profile_id: string | null;
  run_id: string | null;
  prior_log_id: string | null;
  created_at?: number;
}

export function insertLogRow(p: LogRowInsert): string {
  const id = p.id ?? newId();
  const db = getDb();
  db.prepare(
    `INSERT INTO classification_log
     (id, note_id, action, bin_id, new_bin_path, existing_confidence, new_bin_rating,
      reasoning, model, profile_id, run_id, prior_log_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, p.note_id, p.action, p.bin_id, p.new_bin_path, p.existing_confidence, p.new_bin_rating,
    p.reasoning, p.model, p.profile_id, p.run_id, p.prior_log_id, p.created_at ?? Date.now(),
  );
  return id;
}

export interface ProposalRow {
  id: string;
  note_id: string;
  note_title: string;
  proposed_existing_bin_id: string | null;
  existing_confidence: number;
  proposed_new_bin_path: string | null;
  new_bin_rating: number | null;
  no_fit_reasoning: string | null;
  reasoning: string;
  model: string;
  created_at: number;
}

export function listPendingProposals(): ProposalRow[] {
  const db = getDb();
  return db.prepare(
    `SELECT cp.id, cp.note_id, vn.title as note_title, cp.proposed_existing_bin_id,
     cp.existing_confidence, cp.proposed_new_bin_path, cp.new_bin_rating, cp.no_fit_reasoning,
     cp.reasoning, cp.model, cp.created_at
     FROM classification_proposals cp
     JOIN vault_notes vn ON vn.id = cp.note_id
     ORDER BY cp.created_at DESC`
  ).all() as ProposalRow[];
}

export interface RecentAutoRow {
  id: string;
  note_id: string;
  note_title: string;
  action: "auto_assign" | "auto_create_bin";
  bin_id: string | null;
  bin_name: string | null;
  new_bin_path: string | null;
  existing_confidence: number | null;
  new_bin_rating: number | null;
  reasoning: string | null;
  created_at: number;
}

export function listRecentlyAutoClassified(): RecentAutoRow[] {
  const db = getDb();
  const cutoff = Date.now() - 7 * 86400_000;
  return db.prepare(
    `SELECT a.id, a.note_id, vn.title as note_title, a.action, a.bin_id,
     b.name as bin_name, a.new_bin_path, a.existing_confidence, a.new_bin_rating,
     a.reasoning, a.created_at
     FROM classification_log a
     JOIN vault_notes vn ON vn.id = a.note_id
     LEFT JOIN bins b ON b.id = a.bin_id
     WHERE a.action IN ('auto_assign', 'auto_create_bin')
       AND a.created_at > ?
       AND NOT EXISTS (
         SELECT 1 FROM classification_log u
         WHERE u.note_id = a.note_id AND u.action = 'undone' AND u.created_at > a.created_at
       )
     ORDER BY a.created_at DESC`
  ).all(cutoff) as RecentAutoRow[];
}

export interface AcceptProposalArgs {
  proposalId: string;
  binId: string;
  isNewBin: boolean;
}

export function acceptProposal(args: AcceptProposalArgs): void {
  const db = getDb();
  const proposal = db.prepare("SELECT * FROM classification_proposals WHERE id = ?").get(args.proposalId) as {
    id: string; note_id: string; reasoning: string; model: string; profile_id: string; run_id: string;
    existing_confidence: number; new_bin_rating: number | null; proposed_new_bin_path: string | null;
  } | undefined;
  if (!proposal) throw new Error(`proposal ${args.proposalId} not found`);
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, ?, ?, 'agent')`
    ).run(proposal.note_id, args.binId, new Date().toISOString());
    db.prepare("DELETE FROM classification_proposals WHERE id = ?").run(args.proposalId);
    insertLogRow({
      note_id: proposal.note_id,
      action: "accepted",
      bin_id: args.binId,
      new_bin_path: args.isNewBin ? proposal.proposed_new_bin_path : null,
      existing_confidence: proposal.existing_confidence,
      new_bin_rating: proposal.new_bin_rating,
      reasoning: proposal.reasoning,
      model: proposal.model,
      profile_id: proposal.profile_id,
      run_id: proposal.run_id,
      prior_log_id: null,
    });
  })();
}

export function rejectProposal(proposalId: string): void {
  const db = getDb();
  const proposal = db.prepare("SELECT * FROM classification_proposals WHERE id = ?").get(proposalId) as {
    id: string; note_id: string; reasoning: string; model: string; profile_id: string; run_id: string;
    existing_confidence: number; new_bin_rating: number | null;
  } | undefined;
  if (!proposal) throw new Error(`proposal ${proposalId} not found`);
  db.transaction(() => {
    db.prepare("UPDATE vault_notes SET classifier_attempts = classifier_attempts + 1 WHERE id = ?").run(proposal.note_id);
    const attempts = (db.prepare("SELECT classifier_attempts FROM vault_notes WHERE id = ?").get(proposal.note_id) as { classifier_attempts: number }).classifier_attempts;
    if (attempts >= 3) {
      db.prepare("UPDATE vault_notes SET classifier_skip = 1 WHERE id = ?").run(proposal.note_id);
    }
    db.prepare("DELETE FROM classification_proposals WHERE id = ?").run(proposalId);
    insertLogRow({
      note_id: proposal.note_id,
      action: "rejected",
      bin_id: null,
      new_bin_path: null,
      existing_confidence: proposal.existing_confidence,
      new_bin_rating: proposal.new_bin_rating,
      reasoning: null,
      model: proposal.model,
      profile_id: proposal.profile_id,
      run_id: proposal.run_id,
      prior_log_id: null,
    });
  })();
}

export function undoAutoClassification(logId: string): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM classification_log WHERE id = ?").get(logId) as {
    id: string; note_id: string; action: string; bin_id: string | null;
  } | undefined;
  if (!row) throw new Error(`log row ${logId} not found`);
  if (!row.note_id || !row.bin_id) throw new Error("log row missing note_id/bin_id; cannot undo");
  db.transaction(() => {
    db.prepare("DELETE FROM note_bins WHERE note_id = ? AND bin_id = ?").run(row.note_id, row.bin_id);
    let binDeleted = false;
    if (row.action === "auto_create_bin") {
      const remaining = (db.prepare("SELECT COUNT(*) as n FROM note_bins WHERE bin_id = ?").get(row.bin_id) as { n: number }).n;
      if (remaining === 0) {
        db.prepare("DELETE FROM bins WHERE id = ?").run(row.bin_id);
        binDeleted = true;
      }
    }
    db.prepare("UPDATE vault_notes SET classifier_attempts = classifier_attempts + 1 WHERE id = ?").run(row.note_id);
    insertLogRow({
      note_id: row.note_id,
      action: "undone",
      bin_id: binDeleted ? null : row.bin_id,
      new_bin_path: null,
      existing_confidence: null,
      new_bin_rating: null,
      reasoning: null,
      model: null,
      profile_id: null,
      run_id: null,
      prior_log_id: row.id,
    });
  })();
}

export function setClassifierSkip(noteId: string, skip: boolean): void {
  const db = getDb();
  db.prepare("UPDATE vault_notes SET classifier_skip = ? WHERE id = ?").run(skip ? 1 : 0, noteId);
}

export function findExistingBinByParentAndSlug(parentBinId: string | null, slug: string): { id: string; name: string } | null {
  const db = getDb();
  const candidates = db.prepare("SELECT id, name FROM bins WHERE parent_bin_id IS ?").all(parentBinId) as { id: string; name: string }[];
  for (const c of candidates) {
    if (slugify(c.name) === slug) return c;
  }
  return null;
}

export function listUnclassifiedNotes(limit: number): { id: string; title: string; vault_path: string }[] {
  const db = getDb();
  return db.prepare(
    `SELECT vn.id, vn.title, vn.vault_path
     FROM vault_notes vn
     WHERE vn.classifier_skip = 0
       AND vn.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM note_bins nb WHERE nb.note_id = vn.id)
       AND NOT EXISTS (SELECT 1 FROM classification_proposals cp WHERE cp.note_id = vn.id)
     ORDER BY vn.modified_at DESC
     LIMIT ?`
  ).all(limit) as { id: string; title: string; vault_path: string }[];
}
