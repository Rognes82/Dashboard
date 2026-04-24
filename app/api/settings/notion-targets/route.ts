import { NextResponse } from "next/server";
import { getSettingJson, setSettingJson } from "@/lib/queries/app-settings";
import { badRequest, readJson } from "@/lib/validation";

const DB_ID_RE = /^[a-f0-9-]{20,40}$/i;

export async function GET() {
  const targets = getSettingJson<string[]>("notion.sync_targets") ?? [];
  return NextResponse.json({ targets });
}

export async function PUT(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.targets)) return badRequest("targets must be an array of strings");
  const cleaned: string[] = [];
  for (const t of b.targets) {
    if (typeof t !== "string") return badRequest("each target must be a string");
    const trimmed = t.trim().replace(/-/g, "").toLowerCase(); // allow with or without hyphens
    if (!DB_ID_RE.test(t.trim())) return badRequest(`invalid database id: ${t}`);
    cleaned.push(t.trim());
  }
  setSettingJson("notion.sync_targets", cleaned);
  return NextResponse.json({ targets: cleaned });
}
