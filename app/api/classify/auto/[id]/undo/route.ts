import { NextResponse } from "next/server";
import { undoAutoClassification } from "../../../../../../lib/queries/classifications";

export async function POST(_req: Request, ctx: { params: { id: string } }): Promise<Response> {
  try {
    undoAutoClassification(ctx.params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: msg.includes("not found") ? 404 : 500 });
  }
}
