import { NextResponse } from "next/server";
import { listProfiles, createProfile, getActiveProfile } from "@/lib/llm/profiles";
import { badRequest, isNonEmptyString, isOptionalString, readJson } from "@/lib/validation";
import type { LlmProviderType } from "@/lib/llm/types";

function redactKey<T extends { api_key_encrypted: string }>(p: T): Omit<T, "api_key_encrypted"> & { has_key: true } {
  const { api_key_encrypted: _omit, ...rest } = p;
  void _omit;
  return { ...rest, has_key: true };
}

export async function GET() {
  const profiles = listProfiles().map(redactKey);
  const active = getActiveProfile();
  return NextResponse.json({ profiles, active_id: active?.id ?? null });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.name, 80)) return badRequest("name required (<=80 chars)");
  const type = b.type;
  if (type !== "anthropic" && type !== "openai-compatible") return badRequest("type must be anthropic or openai-compatible");
  if (!isNonEmptyString(b.api_key, 500)) return badRequest("api_key required");
  if (!isNonEmptyString(b.default_model, 200)) return badRequest("default_model required");
  if (type === "openai-compatible" && !isNonEmptyString(b.base_url, 500))
    return badRequest("base_url required for openai-compatible");
  if (!isOptionalString(b.base_url, 500)) return badRequest("base_url must be string");
  const maxCtx = b.max_context_tokens;
  if (maxCtx !== undefined && (typeof maxCtx !== "number" || maxCtx < 1000 || maxCtx > 2_000_000)) {
    return badRequest("max_context_tokens must be 1000..2000000");
  }
  const created = createProfile({
    name: b.name as string,
    type: type as LlmProviderType,
    api_key: b.api_key as string,
    base_url: b.base_url as string | undefined,
    default_model: b.default_model as string,
    max_context_tokens: maxCtx as number | undefined,
  });
  return NextResponse.json({ profile: redactKey(created) }, { status: 201 });
}
