"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/Card";
import { NoteList } from "@/components/NoteList";
import { formatRelativeTime } from "@/lib/utils";
import type { VaultNote, Bin } from "@/lib/types";

interface StaleBin extends Bin {
  last_activity: string | null;
}

interface ReviewData {
  today: VaultNote[];
  recent: VaultNote[];
  uncategorized: VaultNote[];
  stale_bins: StaleBin[];
}

export default function ReviewPage() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/review")
      .then((r) => r.json())
      .then((d: ReviewData) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Review</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Today&apos;s activity, uncategorized notes, and bins that need attention.
        </p>
      </div>

      {loading || !data ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardHeader label="Today" right={<span className="text-2xs text-text-muted">{data.today.length}</span>} />
            <NoteList notes={data.today} emptyMessage="Nothing modified today." />
          </Card>

          <Card>
            <CardHeader label="Uncategorized" right={<span className="text-2xs text-text-muted">{data.uncategorized.length}</span>} />
            <NoteList notes={data.uncategorized} emptyMessage="All notes have a bin." />
          </Card>

          <Card>
            <CardHeader label="Recent (7d)" right={<span className="text-2xs text-text-muted">{data.recent.length}</span>} />
            <NoteList notes={data.recent} emptyMessage="No recent activity." />
          </Card>

          <Card>
            <CardHeader label="Stale bins (>30d)" right={<span className="text-2xs text-text-muted">{data.stale_bins.length}</span>} />
            {data.stale_bins.length === 0 ? (
              <p className="text-xs text-text-muted px-2 py-6">No stale bins — keep it up.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-hover">
                {data.stale_bins.map((b) => (
                  <li key={b.id} className="px-2 py-2 flex items-center justify-between gap-3">
                    <span className="text-xs text-text-primary">{b.name}</span>
                    <span className="text-[10px] text-text-muted mono">
                      {b.last_activity ? `last ${formatRelativeTime(b.last_activity)}` : "empty"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
