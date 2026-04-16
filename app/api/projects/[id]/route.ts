import { NextResponse } from "next/server";
import { setProjectClient, getProjectById } from "@/lib/queries/projects";
import { getClientById } from "@/lib/queries/clients";
import { badRequest, readJson } from "@/lib/validation";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = getProjectById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  let clientId: string | null;
  if (b.client_id === undefined) {
    clientId = existing.client_id;
  } else if (b.client_id === null || b.client_id === "") {
    clientId = null;
  } else if (typeof b.client_id === "string") {
    if (!getClientById(b.client_id)) return badRequest("client_id does not exist");
    clientId = b.client_id;
  } else {
    return badRequest("client_id must be a string or null");
  }

  const updated = setProjectClient(params.id, clientId);
  if (!updated) return NextResponse.json({ error: "update failed" }, { status: 500 });
  return NextResponse.json({ project: updated });
}
