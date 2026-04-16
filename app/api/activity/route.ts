import { NextResponse } from "next/server";
import { listRecentActivity } from "@/lib/queries/activity";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"), 50, 500);
  return NextResponse.json({ activity: listRecentActivity(limit) });
}
