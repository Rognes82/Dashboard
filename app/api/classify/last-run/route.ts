import { NextResponse } from "next/server";
import { getDb } from "../../../../lib/db";

export async function GET(): Promise<Response> {
  const row = getDb()
    .prepare("SELECT * FROM classifier_runs ORDER BY started_at DESC LIMIT 1")
    .get();
  return NextResponse.json({ run: row ?? null });
}
