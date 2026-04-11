import { execSync } from "child_process";
import path from "path";
import { upsertAgent } from "../lib/queries/agents";
import { recordSyncRun } from "../lib/queries/sync-status";
import { closeDb } from "../lib/db";

function deriveNameFromCommand(command: string): string {
  const parts = command.trim().split(/\s+/);
  const executable = parts.find((p) => p.includes("/")) ?? parts[0];
  const basename = path.basename(executable, path.extname(executable));
  return basename || command.substring(0, 40);
}

export function parseCrontab(crontab: string): void {
  const lines = crontab.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const schedule = parts.slice(0, 5).join(" ");
    const command = parts.slice(5).join(" ");
    const name = deriveNameFromCommand(command);

    upsertAgent({
      name,
      type: "cron",
      schedule,
      status: "running",
      config_path: command,
    });
  }
}

function main(): void {
  const start = Date.now();
  try {
    let crontab = "";
    try {
      crontab = execSync("crontab -l", { encoding: "utf-8" });
    } catch {
      crontab = "";
    }
    parseCrontab(crontab);
    recordSyncRun({ sync_name: "sync-cron", status: "ok", duration_ms: Date.now() - start });
    console.log(`sync-cron: ok (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordSyncRun({ sync_name: "sync-cron", status: "error", error_message: msg, duration_ms: Date.now() - start });
    console.error(`sync-cron: error — ${msg}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
