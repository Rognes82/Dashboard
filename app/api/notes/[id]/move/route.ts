import { NextResponse } from "next/server";
import { getBinById, moveNoteBetweenBins, NoteNotInSourceBinError } from "@/lib/queries/bins";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.from_bin_id, 32)) return badRequest("from_bin_id required");
  if (!isNonEmptyString(b.to_bin_id, 32)) return badRequest("to_bin_id required");

  const from = getBinById(b.from_bin_id as string);
  const to = getBinById(b.to_bin_id as string);
  if (!from || !to) return NextResponse.json({ error: "bin not found" }, { status: 404 });

  try {
    moveNoteBetweenBins(params.id, b.from_bin_id as string, b.to_bin_id as string);
  } catch (err) {
    if (err instanceof NoteNotInSourceBinError) {
      return NextResponse.json({ error: "note not in source bin" }, { status: 400 });
    }
    // Unknown error — don't leak server details
    return NextResponse.json({ error: "move failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
