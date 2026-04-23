import { NextResponse } from "next/server";
import { listVaultNotes, listVaultNotesByBin } from "@/lib/queries/vault-notes";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get("limit"), 200);
  const binId = searchParams.get("bin");

  const notes = binId ? listVaultNotesByBin(binId, limit) : listVaultNotes(limit);
  return NextResponse.json({ notes });
}
