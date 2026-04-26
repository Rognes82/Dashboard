import { NextResponse } from "next/server";
import { listRecentlyAutoClassified } from "../../../../lib/queries/classifications";

export async function GET(): Promise<Response> {
  const rows = listRecentlyAutoClassified();
  return NextResponse.json({ rows });
}
