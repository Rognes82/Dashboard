import { NextResponse } from "next/server";
import { setClassifierSkip } from "../../../../../lib/queries/classifications";

export async function PATCH(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const body = (await req.json()) as { skip: boolean };
  if (typeof body.skip !== "boolean") {
    return NextResponse.json({ error: "skip must be boolean" }, { status: 400 });
  }
  setClassifierSkip(ctx.params.id, body.skip);
  return NextResponse.json({ ok: true });
}
