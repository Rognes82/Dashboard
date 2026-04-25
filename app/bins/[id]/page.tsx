"use client";

import { useEffect, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { ReadingPane } from "@/components/ReadingPane";
import type { VaultNote } from "@/lib/types";

interface BinShape {
  id: string;
  name: string;
  children?: BinShape[];
}

function findPath(bins: BinShape[], id: string, acc: string[] = []): string[] | null {
  for (const b of bins) {
    const next = [...acc, b.name];
    if (b.id === id) return next;
    if (b.children) {
      const found = findPath(b.children, id, next);
      if (found) return found;
    }
  }
  return null;
}

export default function BinDetailPage({ params }: { params: { id: string } }) {
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/notes?bin=${encodeURIComponent(params.id)}&limit=500`).then((r) => r.json()),
      fetch(`/api/bins`).then((r) => r.json()),
    ]).then(([notesResp, binsResp]) => {
      setNotes(notesResp.notes ?? []);
      const p = findPath(binsResp.bins ?? [], params.id);
      if (p) setPath(p);
      setLoading(false);
    });
  }, [params.id, refreshKey]);

  return (
    <div className="h-screen flex flex-col">
      <div className="px-6 py-4 border-b border-border-subtle">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">
          {path.join(" / ").toLowerCase()}
        </div>
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl text-text-primary font-medium">{path.at(-1) ?? "Bin"}</h1>
          <span className="mono text-2xs text-text-muted">{notes.length} notes</span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-text-muted p-6">Loading…</div>
        ) : (
          <NoteList
            notes={notes}
            onNoteClick={(n) => setReading(n.vault_path)}
            selectedPath={reading}
            emptyMessage="No notes in this bin yet."
            currentBinId={params.id}
            onMutated={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>
      {reading && <ReadingPane path={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
