import { NextResponse } from "next/server";
import { getBinById, getBinDeletePreview } from "@/lib/queries/bins";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(getBinDeletePreview(params.id));
}
