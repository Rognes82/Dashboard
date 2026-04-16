import { NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/queries/clients";
import { badRequest, isNonEmptyString, isOptionalString, readJson } from "@/lib/validation";

export async function GET() {
  const clients = listClients();
  return NextResponse.json({ clients });
}

export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.name, 120)) return badRequest("name is required (1-120 chars)");
  if (!isOptionalString(b.pipeline_stage, 120)) return badRequest("pipeline_stage must be string (<=120 chars)");
  if (!isOptionalString(b.notes, 5000)) return badRequest("notes must be string (<=5000 chars)");

  const client = createClient({
    name: b.name.trim(),
    pipeline_stage: b.pipeline_stage as string | undefined,
    notes: b.notes as string | undefined,
  });
  return NextResponse.json({ client }, { status: 201 });
}
