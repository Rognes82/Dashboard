import { NextResponse } from "next/server";
import {
  listRecentVaultNotes,
  listUncategorizedVaultNotes,
} from "@/lib/queries/vault-notes";
import { listStaleBins } from "@/lib/queries/review";

export async function GET() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hoursSinceStartOfDay = Math.max(
    1,
    Math.ceil((Date.now() - todayStart.getTime()) / 3600_000)
  );

  const today = listRecentVaultNotes(hoursSinceStartOfDay, 100);
  const recent = listRecentVaultNotes(24 * 7, 50); // last 7 days
  const uncategorized = listUncategorizedVaultNotes(100);
  const stale_bins = listStaleBins(30);

  return NextResponse.json({ today, recent, uncategorized, stale_bins });
}
