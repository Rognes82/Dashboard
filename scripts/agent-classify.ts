import { migrate, getDb } from "../lib/db";
import {
  acquireRunLock,
  finishClassifierRun,
  listUnclassifiedNotes,
  type ClassifierRunSummary,
  ConcurrentRunError,
} from "../lib/queries/classifications";
import { runClassifyOnce, type ClassifierLlm } from "../lib/classify/run";
import { createRateLimiter } from "../lib/classify/rate-limit";
import { getSetting } from "../lib/queries/app-settings";
import { resolveClassifyProfileId } from "../lib/classify/profile";
import { getProfile } from "../lib/llm/profiles";
import { buildClassifierLlm } from "../lib/classify/llm-adapter";

export interface BatchArgs {
  trigger: "cron" | "manual";
  llm: ClassifierLlm;
  profileId: string;
  concurrency: number;
  rateLimitRpm: number;
  cap: number;
  vaultPath?: string;
}

const DEFAULT_CAP = 100;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RPM = 45;

export async function runClassifierBatch(args: BatchArgs): Promise<ClassifierRunSummary> {
  const runId = acquireRunLock(args.trigger);
  const summary: ClassifierRunSummary = {
    notes_seen: 0,
    notes_auto_assigned: 0,
    notes_auto_created: 0,
    notes_pending: 0,
    notes_errored: 0,
    error_message: null,
  };
  try {
    const notes = listUnclassifiedNotes(args.cap);
    summary.notes_seen = notes.length;
    if (notes.length === 0) {
      finishClassifierRun(runId, summary);
      return summary;
    }
    const acquire = createRateLimiter({ rpm: args.rateLimitRpm });
    const { default: pLimit } = await import("p-limit");
    const matter = (await import("gray-matter")).default;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const limit = pLimit(args.concurrency);
    const vaultBase = args.vaultPath ?? process.env.VAULT_PATH ?? path.join(process.env.HOME ?? "", "Vault");

    await Promise.all(
      notes.map((n) =>
        limit(async () => {
          await acquire();
          let body = "";
          let frontmatter: Record<string, unknown> = {};
          try {
            const raw = fs.readFileSync(path.join(vaultBase, n.vault_path), "utf8");
            const parsed = matter(raw);
            body = parsed.content;
            frontmatter = parsed.data as Record<string, unknown>;
          } catch {
            summary.notes_errored++;
            return;
          }
          const note = { id: n.id, title: n.title, frontmatter, body };
          const result = await runClassifyOnce({ note, llm: args.llm, runId, profileId: args.profileId });
          if (result.action === "auto_assign") summary.notes_auto_assigned++;
          else if (result.action === "auto_create_bin") summary.notes_auto_created++;
          else if (result.action === "pending") summary.notes_pending++;
          else if (result.action === "error") summary.notes_errored++;
        })
      )
    );
    finishClassifierRun(runId, summary);
    return summary;
  } catch (e) {
    summary.error_message = (e as Error).message;
    finishClassifierRun(runId, summary);
    throw e;
  }
}

export async function main(): Promise<void> {
  const db = getDb();
  migrate(db);

  const profileId = resolveClassifyProfileId();
  if (!profileId) {
    console.error("No classifier profile configured. Set classify.profile_id or llm.active_profile_id in settings.");
    process.exit(1);
  }
  const profile = getProfile(profileId);
  if (!profile) {
    console.error(`Classifier profile ${profileId} not found.`);
    process.exit(1);
  }

  const llm = buildClassifierLlm(profile);
  const rateLimitRpm = parseInt(getSetting("classify.rate_limit_rpm") ?? String(DEFAULT_RPM), 10);
  const concurrency = DEFAULT_CONCURRENCY;
  const cap = DEFAULT_CAP;

  try {
    const summary = await runClassifierBatch({
      trigger: "cron",
      llm,
      profileId,
      concurrency,
      rateLimitRpm,
      cap,
    });
    console.log(JSON.stringify(summary));
  } catch (e) {
    if (e instanceof ConcurrentRunError) {
      console.log("classifier already running; exiting cleanly");
      process.exit(0);
    }
    console.error("classifier failed:", (e as Error).message);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
