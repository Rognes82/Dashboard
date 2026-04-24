import { NextResponse } from "next/server";
import { setActiveProfile, getProfile } from "@/lib/llm/profiles";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export async function PUT(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.id, 32)) return badRequest("id required");
  if (!getProfile(b.id as string)) return NextResponse.json({ error: "profile not found" }, { status: 404 });
  setActiveProfile(b.id as string);
  return NextResponse.json({ ok: true, active_id: b.id });
}
