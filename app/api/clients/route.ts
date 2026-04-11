import { NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/queries/clients";

export async function GET() {
  const clients = listClients();
  return NextResponse.json({ clients });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const client = createClient({
    name: body.name,
    pipeline_stage: body.pipeline_stage,
    notes: body.notes,
  });
  return NextResponse.json({ client }, { status: 201 });
}
