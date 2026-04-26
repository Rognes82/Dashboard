import { NextResponse } from "next/server";
import { listPendingProposals } from "../../../../lib/queries/classifications";
import { listBins } from "../../../../lib/queries/bins";
import { buildBinTree, type BinRow } from "../../../../lib/classify/paths";

export async function GET(): Promise<Response> {
  const proposals = listPendingProposals();
  const bins = listBins() as BinRow[];
  const tree = buildBinTree(bins);
  const idToPath = new Map<string, string>();
  for (const [path, id] of tree.entries()) idToPath.set(id, path);
  const enriched = proposals.map((p) => ({
    id: p.id,
    note_id: p.note_id,
    note_title: p.note_title,
    existing_bin_path: p.proposed_existing_bin_id ? idToPath.get(p.proposed_existing_bin_id) ?? null : null,
    existing_confidence: p.existing_confidence,
    new_bin_path: p.proposed_new_bin_path,
    new_bin_rating: p.new_bin_rating,
    reasoning: p.reasoning,
  }));
  return NextResponse.json({ proposals: enriched });
}
