import { NextResponse } from "next/server";
import { getClientBySlug, updateClientStatus } from "@/lib/queries/clients";
import { listProjectsByClient } from "@/lib/queries/projects";
import { listFilesByClient } from "@/lib/queries/files";
import { listNotesByClient } from "@/lib/queries/notes";
import { listActivityByClient } from "@/lib/queries/activity";

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
  const body = await req.json();
  const updated = updateClientStatus(client.id, body.status, body.pipeline_stage);
  return NextResponse.json({ client: updated });
}
