import { NextResponse } from "next/server";
import { updateProfile, deleteProfile, getProfile } from "@/lib/llm/profiles";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";
import type { LlmProviderType } from "@/lib/llm/types";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = getProfile(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  if (b.name !== undefined && !isNonEmptyString(b.name, 80)) return badRequest("name must be non-empty string");
  if (b.type !== undefined && b.type !== "anthropic" && b.type !== "openai-compatible")
    return badRequest("type must be anthropic or openai-compatible");
  if (b.api_key !== undefined && !isNonEmptyString(b.api_key, 500)) return badRequest("api_key must be non-empty string");
  if (b.default_model !== undefined && !isNonEmptyString(b.default_model, 200))
    return badRequest("default_model must be non-empty string");
  const maxCtx = b.max_context_tokens;
  if (maxCtx !== undefined && (typeof maxCtx !== "number" || maxCtx < 1000 || maxCtx > 2_000_000)) {
    return badRequest("max_context_tokens must be 1000..2000000");
  }

  const updated = updateProfile(params.id, {
    name: b.name as string | undefined,
    type: b.type as LlmProviderType | undefined,
    api_key: b.api_key as string | undefined,
    base_url: b.base_url as string | undefined,
    default_model: b.default_model as string | undefined,
    max_context_tokens: maxCtx as number | undefined,
  });
  if (!updated) return NextResponse.json({ error: "update failed" }, { status: 500 });
  const { api_key_encrypted: _, ...rest } = updated;
  void _;
  return NextResponse.json({ profile: { ...rest, has_key: true } });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const existing = getProfile(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  deleteProfile(params.id);
  return NextResponse.json({ ok: true });
}
