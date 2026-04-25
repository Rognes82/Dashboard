import { NextResponse } from "next/server";
import { getBinById, moveNoteBetweenBins } from "@/lib/queries/bins";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.from_bin_id, 32)) return badRequest("from_bin_id required");
  if (!isNonEmptyString(b.to_bin_id, 32)) return badRequest("to_bin_id required");

  const from = getBinById(b.from_bin_id as string);
  const to = getBinById(b.to_bin_id as string);
  if (!from || !to) return NextResponse.json({ error: "bin not found" }, { status: 404 });

  try {
    moveNoteBetweenBins(params.id, b.from_bin_id as string, b.to_bin_id as string);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    // Whitelist known sentinel messages from moveNoteBetweenBins. Anything else
    // (FK violation, SQLITE_BUSY, etc.) returns a generic message to avoid leaking server details.
    const msg = raw === "note not in source bin" ? raw : "move failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
