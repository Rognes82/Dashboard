import { NextResponse } from "next/server";
import { listRecentActivity } from "@/lib/queries/activity";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  return NextResponse.json({ activity: listRecentActivity(limit) });
}
