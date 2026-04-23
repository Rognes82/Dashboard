import { NextResponse } from "next/server";
import { unassignNoteFromBin } from "@/lib/queries/bins";

export async function DELETE(_req: Request, { params }: { params: { id: string; noteId: string } }) {
  unassignNoteFromBin(params.noteId, params.id);
  return NextResponse.json({ ok: true });
}
