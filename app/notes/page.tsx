"use client";

import { useEffect, useState } from "react";
import { BinTree } from "@/components/BinTree";
import { NoteList } from "@/components/NoteList";
import { SearchBar } from "@/components/SearchBar";
import type { BinNode, VaultNote } from "@/lib/types";

export default function NotesPage() {
  const [bins, setBins] = useState<BinNode[]>([]);
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [notes, setNotes] = useState<VaultNote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/bins")
      .then((r) => r.json())
      .then((d) => setBins(d.bins ?? []));
  }, []);

  useEffect(() => {
    setLoading(true);
    const url = selectedBinId
      ? `/api/notes?bin=${encodeURIComponent(selectedBinId)}&limit=200`
      : "/api/notes?limit=200";
    fetch(url)
      .then((r) => r.json())
      .then((d) => setNotes(d.notes ?? []))
      .finally(() => setLoading(false));
  }, [selectedBinId]);

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="mono text-lg font-semibold text-text-primary">Notes</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {loading ? "Loading…" : `${notes.length} notes${selectedBinId ? " in selected bin" : ""}`}
          </p>
        </div>
        <div className="w-80">
          <SearchBar />
        </div>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-4">
        <aside className="bg-card border border-border rounded p-2 h-fit">
          <BinTree bins={bins} selectedBinId={selectedBinId} onSelect={setSelectedBinId} />
        </aside>
        <main className="bg-card border border-border rounded">
          <NoteList notes={notes} onNoteClick={() => {}} emptyMessage={selectedBinId ? "No notes in this bin." : "No notes yet. Run Settings → Initial vault scan."} />
        </main>
      </div>
    </div>
  );
}
