import { NextResponse } from "next/server";
import { listAgents } from "@/lib/queries/agents";
import { listSyncStatuses } from "@/lib/queries/sync-status";

export async function GET() {
  return NextResponse.json({
    agents: listAgents(),
    sync: listSyncStatuses(),
  });
}
