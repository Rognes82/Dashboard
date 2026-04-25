import { NextResponse } from "next/server";
import { getBinById, getBinMergePreview } from "@/lib/queries/bins";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(getBinMergePreview(params.id));
}
