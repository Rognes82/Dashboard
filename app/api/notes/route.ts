import { NextResponse } from "next/server";
import { listNotes } from "@/lib/queries/notes";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "200", 10);
  return NextResponse.json({ notes: listNotes(limit) });
}
