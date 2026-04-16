import { NextResponse } from "next/server";
import { getClientBySlug, updateClientStatus } from "@/lib/queries/clients";
import { listProjectsByClient } from "@/lib/queries/projects";
import { listFilesByClient } from "@/lib/queries/files";
import { listNotesByClient } from "@/lib/queries/notes";
import { listActivityByClient } from "@/lib/queries/activity";
import { badRequest, isClientStatus, isOptionalString, readJson } from "@/lib/validation";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const client = getClientBySlug(params.slug);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    client,
    projects: listProjectsByClient(client.id),
    files: listFilesByClient(client.id),
    notes: listNotesByClient(client.id),
    activity: listActivityByClient(client.id),
  });
}

export async function PATCH(req: Request, { params }: { params: { slug: string } }) {
  const client = getClientBySlug(params.slug);
  if (!client) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  const nextStatus = b.status === undefined ? client.status : b.status;
  if (!isClientStatus(nextStatus)) {
    return badRequest("status must be one of: active, paused, completed");
  }
  if (!isOptionalString(b.pipeline_stage, 120)) {
    return badRequest("pipeline_stage must be string (<=120 chars)");
  }

  const pipelineStage =
    b.pipeline_stage === undefined ? client.pipeline_stage ?? undefined : (b.pipeline_stage as string | undefined);

  const updated = updateClientStatus(client.id, nextStatus, pipelineStage);
  if (!updated) return NextResponse.json({ error: "update failed" }, { status: 500 });
  return NextResponse.json({ client: updated });
}
