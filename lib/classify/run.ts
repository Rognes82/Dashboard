import { getDb } from "../db";
import { listBins } from "../queries/bins";
import {
  insertProposal, insertLogRow, findExistingBinByParentAndSlug,
} from "../queries/classifications";
import { newId } from "../utils";
import { buildBinTree, type BinRow } from "./paths";
import { decide, DEFAULT_THRESHOLDS, type Thresholds } from "./decide";
import { parseClassifierOutput, ClassifierOutputError } from "./parse";
import { buildSystemPrompt, buildNoteUserMessage } from "./prompt";

export interface ClassifierLlm {
  complete: (system: string, user: string) => Promise<string>;
  modelName: string;
}

export interface NoteForRun {
  id: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface RunArgs {
  note: NoteForRun;
  llm: ClassifierLlm;
  runId: string;
  profileId: string;
  thresholds?: Thresholds;
}

export type RunResult =
  | { action: "auto_assign" | "auto_create_bin" | "pending" }
  | { action: "error"; reason: string };

const RETRY_FOLLOWUP = "Your previous response was not valid JSON. Return ONLY valid JSON matching the schema, no prose, no markdown.";

export async function runClassifyOnce(args: RunArgs): Promise<RunResult> {
  const db = getDb();
  const thresholds = args.thresholds ?? DEFAULT_THRESHOLDS;
  const bins = listBins() as BinRow[];
  const tree = buildBinTree(bins);
  const system = buildSystemPrompt(tree);
  const user = buildNoteUserMessage(args.note);

  let raw: string;
  try {
    raw = await args.llm.complete(system, user);
  } catch (e) {
    return logErrorAndReturn(args, `llm_call_failed: ${(e as Error).message}`);
  }

  let parsed;
  try {
    parsed = parseClassifierOutput(raw);
  } catch (e) {
    if (!(e instanceof ClassifierOutputError)) {
      return logErrorAndReturn(args, `parse_failed: ${(e as Error).message}`);
    }
    let raw2: string;
    try {
      raw2 = await args.llm.complete(system + "\n\n" + RETRY_FOLLOWUP, user);
    } catch (e2) {
      return logErrorAndReturn(args, `llm_retry_failed: ${(e2 as Error).message}`);
    }
    try {
      parsed = parseClassifierOutput(raw2);
    } catch (e3) {
      return logErrorAndReturn(args, `parse_failed_after_retry: ${(e3 as Error).message}`);
    }
  }

  const decision = decide(parsed, thresholds, tree);

  if (decision.action === "auto_assign") {
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, ?, ?, 'agent')")
        .run(args.note.id, decision.bin_id, new Date().toISOString());
      insertLogRow({
        note_id: args.note.id,
        action: "auto_assign",
        bin_id: decision.bin_id,
        new_bin_path: null,
        existing_confidence: decision.confidence_used,
        new_bin_rating: null,
        reasoning: parsed.existing_match.reasoning,
        model: args.llm.modelName,
        profile_id: args.profileId,
        run_id: args.runId,
        prior_log_id: null,
      });
    })();
    return { action: "auto_assign" };
  }

  if (decision.action === "auto_create_bin") {
    let resolvedBinId = "";
    let resolvedAction: "auto_assign" | "auto_create_bin" = "auto_create_bin";
    db.transaction(() => {
      const existing = findExistingBinByParentAndSlug(decision.parent_bin_id, decision.slug);
      if (existing) {
        resolvedBinId = existing.id;
        resolvedAction = "auto_assign";
      } else {
        const newBinId = newId();
        db.prepare(
          "INSERT INTO bins (id, name, parent_bin_id, source_seed, created_at, sort_order) VALUES (?, ?, ?, NULL, ?, ?)"
        ).run(newBinId, decision.name, decision.parent_bin_id, new Date().toISOString(), 0);
        resolvedBinId = newBinId;
      }
      db.prepare("INSERT OR IGNORE INTO note_bins (note_id, bin_id, assigned_at, assigned_by) VALUES (?, ?, ?, 'agent')")
        .run(args.note.id, resolvedBinId, new Date().toISOString());
      insertLogRow({
        note_id: args.note.id,
        action: resolvedAction,
        bin_id: resolvedBinId,
        new_bin_path: resolvedAction === "auto_create_bin" ? decision.path : null,
        existing_confidence: null,
        new_bin_rating: decision.rating,
        reasoning: parsed.proposed_new_bin?.reasoning ?? null,
        model: args.llm.modelName,
        profile_id: args.profileId,
        run_id: args.runId,
        prior_log_id: null,
      });
    })();
    return { action: resolvedAction };
  }

  // pending
  insertProposal({
    note_id: args.note.id,
    proposed_existing_bin_id: decision.existing_bin_id,
    existing_confidence: decision.existing_confidence,
    proposed_new_bin_path: decision.new_bin_path,
    new_bin_rating: decision.new_bin_rating,
    no_fit_reasoning: decision.no_fit_reasoning,
    reasoning: parsed.existing_match.reasoning + (parsed.proposed_new_bin ? ` || new-bin: ${parsed.proposed_new_bin.reasoning}` : ""),
    model: args.llm.modelName,
    profile_id: args.profileId,
    run_id: args.runId,
  });
  insertLogRow({
    note_id: args.note.id,
    action: "pending",
    bin_id: decision.existing_bin_id,
    new_bin_path: decision.new_bin_path,
    existing_confidence: decision.existing_confidence,
    new_bin_rating: decision.new_bin_rating,
    reasoning: parsed.existing_match.reasoning,
    model: args.llm.modelName,
    profile_id: args.profileId,
    run_id: args.runId,
    prior_log_id: null,
  });
  return { action: "pending" };
}

function logErrorAndReturn(args: RunArgs, reason: string): RunResult {
  insertLogRow({
    note_id: args.note.id,
    action: "error",
    bin_id: null,
    new_bin_path: null,
    existing_confidence: null,
    new_bin_rating: null,
    reasoning: reason,
    model: args.llm.modelName,
    profile_id: args.profileId,
    run_id: args.runId,
    prior_log_id: null,
  });
  return { action: "error", reason };
}
