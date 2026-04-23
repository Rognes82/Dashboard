import { NextResponse } from "next/server";
import { searchVaultNotes } from "@/lib/queries/vault-notes";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ hits: [] });
  const limit = parseLimit(searchParams.get("limit"), 50);

  // Sanitize: FTS5 special characters could be used as attack vectors.
  // Wrap in quotes for phrase match, escape inner quotes by doubling.
  const safeQuery = `"${q.replace(/"/g, '""')}"`;

  try {
    const hits = searchVaultNotes(safeQuery, limit);
    return NextResponse.json({ hits });
  } catch (err) {
    return NextResponse.json({ error: "search failed", detail: String(err) }, { status: 500 });
  }
}
