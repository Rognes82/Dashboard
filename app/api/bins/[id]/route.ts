import { NextResponse } from "next/server";
import { getBinById, updateBin, deleteBin, mergeBin, isDescendantOf } from "@/lib/queries/bins";
import { badRequest, isNonEmptyString, isOptionalString, readJson } from "@/lib/validation";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;

  // Merge operation is a special PATCH with a merge_into target
  if (typeof b.merge_into === "string") {
    const target = getBinById(b.merge_into);
    if (!target) return badRequest("merge_into target not found");
    mergeBin(params.id, b.merge_into);
    return NextResponse.json({ merged_into: b.merge_into });
  }

  if (b.name !== undefined && !isNonEmptyString(b.name, 120)) return badRequest("name must be non-empty string (<=120)");
  if (!isOptionalString(b.parent_bin_id, 32)) return badRequest("parent_bin_id must be string");
  if (b.sort_order !== undefined && typeof b.sort_order !== "number") return badRequest("sort_order must be number");

  // Cycle prevention for parent_bin_id changes
  if (typeof b.parent_bin_id === "string") {
    if (b.parent_bin_id === params.id) return badRequest("bin cannot be its own parent");
    if (isDescendantOf(b.parent_bin_id, params.id)) {
      return badRequest("bin cannot be a child of its own descendant");
    }
  }

  const updated = updateBin(params.id, {
    name: b.name as string | undefined,
    parent_bin_id: b.parent_bin_id === undefined ? undefined : (b.parent_bin_id as string | null),
    sort_order: b.sort_order as number | undefined,
  });
  return NextResponse.json({ bin: updated });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.source_seed) {
    return NextResponse.json({ error: "seeded bins cannot be deleted" }, { status: 403 });
  }
  deleteBin(params.id);
  return NextResponse.json({ ok: true });
}
