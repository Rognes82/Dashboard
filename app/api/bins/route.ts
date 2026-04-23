import { NextResponse } from "next/server";
import { listBinTree, createBin } from "@/lib/queries/bins";
import { badRequest, isNonEmptyString, isOptionalString, readJson } from "@/lib/validation";

export async function GET() {
  return NextResponse.json({ bins: listBinTree() });
}

export async function POST(req: Request) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.name, 120)) return badRequest("name required (<=120 chars)");
  if (!isOptionalString(b.parent_bin_id, 32)) return badRequest("parent_bin_id must be string");
  const bin = createBin({
    name: b.name as string,
    parent_bin_id: (b.parent_bin_id as string | undefined) ?? null,
  });
  return NextResponse.json({ bin }, { status: 201 });
}
