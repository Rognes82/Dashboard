import { NextResponse } from "next/server";
import { assignNoteToBin, getBinById } from "@/lib/queries/bins";
import { getVaultNoteById } from "@/lib/queries/vault-notes";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const bin = getBinById(params.id);
  if (!bin) return NextResponse.json({ error: "bin not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.note_id, 32)) return badRequest("note_id required");
  const note = getVaultNoteById(b.note_id as string);
  if (!note) return NextResponse.json({ error: "note not found" }, { status: 404 });
  assignNoteToBin({ note_id: note.id, bin_id: bin.id, assigned_by: "manual" });
  return NextResponse.json({ ok: true });
}
