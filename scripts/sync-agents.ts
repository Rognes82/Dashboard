import fs from "fs";
import path from "path";
import { upsertAgent } from "../lib/queries/agents";
import { recordSyncRun } from "../lib/queries/sync-status";
import { closeDb } from "../lib/db";
import type { AgentType, AgentStatus } from "../lib/types";

interface AgentConfig {
  name: string;
  type: AgentType;
  schedule?: string;
  host?: string;
  status?: AgentStatus;
  last_run_at?: string;
  last_output?: string;
}

export function scanAgentConfigDir(dir: string): void {
  if (!fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const fullPath = path.join(dir, entry);
    try {
      const raw = fs.readFileSync(fullPath, "utf-8");
      const config: AgentConfig = JSON.parse(raw);
      if (!config.name || !config.type) continue;
      upsertAgent({
        name: config.name,
        type: config.type,
        schedule: config.schedule,
        host: config.host ?? "mac_mini",
        status: config.status ?? "stopped",
        last_run_at: config.last_run_at,
        last_output: config.last_output,
        config_path: fullPath,
      });
    } catch (err) {
      console.warn(`sync-agents: failed to parse ${entry}: ${err}`);
    }
  }
}

function main(): void {
  const start = Date.now();
  const configDir = process.env.AGENT_CONFIG_DIR ?? path.join(process.env.HOME ?? "", ".dashboard", "agents");
  try {
    scanAgentConfigDir(configDir);
    recordSyncRun({ sync_name: "sync-agents", status: "ok", duration_ms: Date.now() - start });
    console.log(`sync-agents: ok (${Date.now() - start}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordSyncRun({ sync_name: "sync-agents", status: "error", error_message: msg, duration_ms: Date.now() - start });
    console.error(`sync-agents: error — ${msg}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}
