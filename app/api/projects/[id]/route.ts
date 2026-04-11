import { NextResponse } from "next/server";
import { setProjectClient, getProjectById } from "@/lib/queries/projects";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = getProjectById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json();
  const clientId = body.client_id === undefined ? existing.client_id : body.client_id;
  const updated = setProjectClient(params.id, clientId);
  return NextResponse.json({ project: updated });
}
