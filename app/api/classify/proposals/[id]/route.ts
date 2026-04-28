import { NextResponse } from "next/server";
import { acceptProposal, rejectProposal, findExistingBinByParentAndSlug } from "../../../../../lib/queries/classifications";
import { getDb } from "../../../../../lib/db";
import { newId, slugify } from "../../../../../lib/utils";
import { normalizeLlmPath } from "../../../../../lib/classify/paths";

interface AcceptBody { action: "accept" }
interface RejectBody { action: "reject" }
interface AcceptNewBinBody { action: "accept_new_bin"; path: string }
type Body = AcceptBody | RejectBody | AcceptNewBinBody;

function titleCase(slug: string): string {
  return slug.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
}

function ensureBinChain(path: string): string {
  const segments = path.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) throw new Error("empty path");
  const db = getDb();
  let parentId: string | null = null;
  let lastId = "";
  for (const seg of segments) {
    const slug = slugify(seg);
    if (!slug) throw new Error(`invalid segment: ${seg}`);
    const existing = findExistingBinByParentAndSlug(parentId, slug);
    if (existing) {
      lastId = existing.id;
    } else {
      const newBinId = newId();
      db.prepare("INSERT INTO bins (id, name, parent_bin_id, source_seed, created_at, sort_order) VALUES (?, ?, ?, NULL, ?, ?)")
        .run(newBinId, titleCase(slug), parentId, new Date().toISOString(), 0);
      lastId = newBinId;
    }
    parentId = lastId;
  }
  return lastId;
}

export async function PATCH(req: Request, ctx: { params: { id: string } }): Promise<Response> {
  const body = (await req.json()) as Body;
  const proposalId = ctx.params.id;
  try {
    if (body.action === "accept") {
      const db = getDb();
      const proposal = db.prepare("SELECT proposed_existing_bin_id, proposed_new_bin_path FROM classification_proposals WHERE id = ?").get(proposalId) as {
        proposed_existing_bin_id: string | null; proposed_new_bin_path: string | null;
      } | undefined;
      if (!proposal) return NextResponse.json({ error: "not found" }, { status: 404 });
      let binId: string | null = proposal.proposed_existing_bin_id;
      if (!binId && proposal.proposed_new_bin_path) {
        binId = ensureBinChain(normalizeLlmPath(proposal.proposed_new_bin_path));
        acceptProposal({ proposalId, binId, isNewBin: true });
      } else if (binId) {
        acceptProposal({ proposalId, binId, isNewBin: false });
      } else {
        return NextResponse.json({ error: "proposal has no bin to accept" }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }
    if (body.action === "reject") {
      rejectProposal(proposalId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "accept_new_bin") {
      const path = normalizeLlmPath(body.path);
      if (!path) return NextResponse.json({ error: "invalid path" }, { status: 400 });
      const binId = ensureBinChain(path);
      acceptProposal({ proposalId, binId, isNewBin: true });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
