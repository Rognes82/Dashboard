"use client";

import { useEffect, useState } from "react";
import type { VaultNoteSearchHit } from "@/lib/types";

interface Props {
  onSelectHit?: (hit: VaultNoteSearchHit) => void;
}

export function SearchBar({ onSelectHit }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VaultNoteSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/notes/search?q=${encodeURIComponent(query)}&limit=15`);
        const data = await res.json();
        setHits(data.hits ?? []);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search notes…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="w-full bg-base border border-border rounded px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent-green focus:outline-none"
      />
      {open && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded shadow-lg max-h-80 overflow-auto z-50">
          {loading && <div className="px-3 py-2 text-[10px] text-text-muted">Searching…</div>}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-2 text-[10px] text-text-muted">No matches.</div>
          )}
          {hits.map((hit) => (
            <a
              key={hit.note.id}
              href={`/notes/${hit.note.id}`}
              onClick={() => onSelectHit?.(hit)}
              className="block px-3 py-2 hover:bg-hover border-b border-hover last:border-0"
            >
              <div className="text-xs text-text-primary font-medium">{hit.note.title}</div>
              <div
                className="text-[10px] text-text-secondary line-clamp-2 mt-0.5"
                dangerouslySetInnerHTML={{ __html: hit.snippet }}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
