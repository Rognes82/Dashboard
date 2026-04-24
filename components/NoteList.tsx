"use client";

import type { VaultNote } from "@/lib/types";

interface Props {
  notes: VaultNote[];
  onNoteClick: (note: VaultNote) => void;
  emptyMessage?: string;
  selectedPath?: string | null;
}

const sourceLabels: Record<VaultNote["source"], string> = {
  obsidian: "obsidian",
  notion: "notion",
  capture: "capture",
  "apple-notes": "apple notes",
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400_000);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function NoteList({ notes, onNoteClick, emptyMessage = "No notes.", selectedPath }: Props) {
  if (notes.length === 0) {
    return <div className="text-xs text-text-muted px-2 py-8 text-center">{emptyMessage}</div>;
  }
  return (
    <ul className="flex flex-col">
      {notes.map((n) => {
        const isSel = n.vault_path === selectedPath;
        return (
          <li key={n.id}>
            <button
              onClick={() => onNoteClick(n)}
              className={`w-full text-left px-5 py-2.5 border-b border-border-subtle flex items-center gap-3 ${
                isSel
                  ? "bg-accent-tint border-l-2 border-l-accent"
                  : "hover:bg-hover"
              }`}
            >
              <span className="text-xs text-text-primary flex-1 truncate">{n.title}</span>
              <span className="mono text-2xs text-text-subtle">{sourceLabels[n.source]}</span>
              <span className="mono text-2xs text-text-subtle w-16 text-right">{relTime(n.modified_at)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
