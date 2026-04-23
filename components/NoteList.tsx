import Link from "next/link";
import type { VaultNote } from "@/lib/types";
import { formatRelativeTime } from "@/lib/utils";
import { Badge } from "./Badge";

const sourceLabels: Record<VaultNote["source"], string> = {
  obsidian: "Obsidian",
  notion: "Notion",
  capture: "Capture",
  "apple-notes": "Apple Notes",
};

interface Props {
  notes: VaultNote[];
  emptyMessage?: string;
}

export function NoteList({ notes, emptyMessage = "No notes in this view." }: Props) {
  if (notes.length === 0) {
    return <p className="text-xs text-text-muted px-2 py-6">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-hover">
      {notes.map((n) => (
        <Link
          key={n.id}
          href={`/notes/${n.id}`}
          className="flex items-start justify-between gap-3 px-2 py-2.5 hover:bg-hover/40"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-xs text-text-primary font-medium truncate">{n.title}</span>
              <Badge>{sourceLabels[n.source]}</Badge>
            </div>
            <div className="text-[10px] text-text-muted mono truncate">{n.vault_path}</div>
          </div>
          <div className="text-[10px] text-text-muted mono shrink-0">
            {formatRelativeTime(n.modified_at)}
          </div>
        </Link>
      ))}
    </div>
  );
}
