import { NextResponse } from "next/server";
import { listNotes } from "@/lib/queries/notes";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"), 200);
  return NextResponse.json({ notes: listNotes(limit) });
}
