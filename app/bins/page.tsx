"use client";

import { useEffect, useState } from "react";
import { NoteList } from "@/components/NoteList";
import { ReadingPane } from "@/components/ReadingPane";
import type { VaultNote } from "@/lib/types";

export default function BinsDefaultPage() {
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetch("/api/notes?limit=100")
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  // Refetch when sidebar reports a bin mutation (e.g., user dragged a note
  // out of this view onto a sidebar bin). Without this, the moved note
  // would still appear here until manual reload.
  useEffect(() => {
    function onMutated() { setRefreshKey((k) => k + 1); }
    window.addEventListener("dashboard-bins-mutated", onMutated);
    return () => window.removeEventListener("dashboard-bins-mutated", onMutated);
  }, []);

  return (
    <div className="h-screen flex flex-col">
      <div className="px-6 py-4 border-b border-border-subtle">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">workspace</div>
        <h1 className="text-xl text-text-primary font-medium">Recent</h1>
        <div className="text-2xs text-text-muted mt-1 mono">Pick a bin from the sidebar to browse it.</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-text-muted p-6">Loading…</div>
        ) : (
          <NoteList
            notes={notes}
            onNoteClick={(n) => setReading(n.vault_path)}
            selectedPath={reading}
            emptyMessage="No notes yet."
            currentBinId={null}
            onMutated={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>
      {reading && <ReadingPane path={reading} onClose={() => setReading(null)} />}
    </div>
  );
}
