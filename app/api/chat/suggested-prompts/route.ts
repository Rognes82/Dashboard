import { NextResponse } from "next/server";
import { listRecentVaultNotes } from "@/lib/queries/vault-notes";

export async function GET() {
  const recent = listRecentVaultNotes(24 * 30, 3);
  if (recent.length === 0) return NextResponse.json({ prompts: [] });
  const prompts = recent.slice(0, 3).map((n, i) => {
    const title = n.title.slice(0, 60);
    if (i === 0) return `Summarize ${title}`;
    if (i === 1) return `What did I note about ${title.split(/\s+/).slice(0, 3).join(" ")}`;
    return `What's in my recent notes`;
  });
  return NextResponse.json({ prompts });
}
