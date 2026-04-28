import { NextResponse } from "next/server";
import fs from "fs";
import { listAgents } from "@/lib/queries/agents";
import { listSyncStatuses } from "@/lib/queries/sync-status";
import { getVaultPath } from "@/lib/vault/path";

function readVaultStatus() {
  const vaultPath = getVaultPath();
  const exists = fs.existsSync(vaultPath);
  let writable = false;
  if (exists) {
    try {
      fs.accessSync(vaultPath, fs.constants.R_OK | fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
  }
  return { path: vaultPath, exists, writable };
}

export async function GET() {
  return NextResponse.json({
    agents: listAgents(),
    sync: listSyncStatuses(),
    vault: readVaultStatus(),
  });
}
