import { NextResponse } from "next/server";
import {
  listVaultNotes,
  listVaultNotesByBin,
  listVaultNotesWithBins,
  listVaultNotesByBinWithBins,
} from "@/lib/queries/vault-notes";
import { parseLimit } from "@/lib/validation";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get("limit"), 200);
  const binId = searchParams.get("bin");
  const includeBins = (searchParams.get("include") ?? "").split(",").includes("bins");

  let notes;
  if (includeBins) {
    notes = binId ? listVaultNotesByBinWithBins(binId, limit) : listVaultNotesWithBins(limit);
  } else {
    notes = binId ? listVaultNotesByBin(binId, limit) : listVaultNotes(limit);
  }
  return NextResponse.json({ notes });
}
