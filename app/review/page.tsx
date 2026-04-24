"use client";

import { useEffect, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { ReadingPane } from "@/components/ReadingPane";
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

function relTime(iso: string | null): string {
  if (!iso) return "empty";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400_000);
  if (d === 0) return "today";
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}

export default function ReviewPage() {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/review")
      .then((r) => r.json())
      .then((d: ReviewData) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-screen overflow-y-auto">
      <div className="px-6 py-6">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">daily triage</div>
        <h1 className="text-xl text-text-primary font-medium mb-6">Review</h1>

        {loading || !data ? (
          <div className="text-xs text-text-muted">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Card title="Today" count={data.today.length}>
              <NoteList notes={data.today} onNoteClick={(n) => setReading(n.vault_path)} selectedPath={reading} emptyMessage="Nothing modified today." />
            </Card>
            <Card title="Uncategorized" count={data.uncategorized.length}>
              <NoteList notes={data.uncategorized} onNoteClick={(n) => setReading(n.vault_path)} selectedPath={reading} emptyMessage="All notes have a bin." />
            </Card>
            <Card title="Recent · 7d" count={data.recent.length}>
              <NoteList notes={data.recent} onNoteClick={(n) => setReading(n.vault_path)} selectedPath={reading} emptyMessage="No recent activity." />
            </Card>
            <Card title="Stale bins · 30d+" count={data.stale_bins.length}>
              {data.stale_bins.length === 0 ? (
                <div className="text-xs text-text-muted px-2 py-8 text-center">No stale bins.</div>
              ) : (
                <ul>
                  {data.stale_bins.map((b) => (
                    <li key={b.id} className="px-5 py-2.5 border-b border-border-subtle flex justify-between mono text-xs">
                      <span className="text-text-primary">{b.name.toLowerCase()}</span>
                      <span className="text-text-subtle">{relTime(b.last_activity)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
      {reading && <ReadingPane path={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

function Card({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="bg-raised border border-border-default rounded-md">
      <div className="px-4 py-3 flex items-center justify-between border-b border-border-subtle">
        <span className="mono text-2xs text-text-primary uppercase tracking-wider font-medium">{title}</span>
        <span className="mono text-2xs text-text-subtle">{count}</span>
      </div>
      <div>{children}</div>
    </div>
  );
}
