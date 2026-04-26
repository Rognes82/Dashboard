"use client";

import { useState } from "react";
import type { VaultNote } from "@/lib/types";
import { useContextMenu } from "./ContextMenu";
import { useToast } from "./chat/ToastProvider";
import { useDrag } from "@/lib/dnd";
import { BinPicker } from "./BinPicker";

interface Props {
  notes: VaultNote[];
  onNoteClick: (note: VaultNote) => void;
  emptyMessage?: string;
  selectedPath?: string | null;
  /** Bin currently displayed (null for Recent view). */
  currentBinId?: string | null;
  /** Display name of the current bin — used in Remove toast. Optional. */
  currentBinName?: string;
  /** note_id → bin_ids[]. Optional; if undefined, multi-bin badge is hidden. */
  noteBins?: Map<string, string[]>;
  /** Refresh callback after a mutation. */
  onMutated?: () => void;
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

export function NoteList({
  notes,
  onNoteClick,
  emptyMessage = "No notes.",
  selectedPath,
  currentBinId,
  currentBinName,
  noteBins,
  onMutated,
}: Props) {
  const menu = useContextMenu();
  const { show } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMode, setPickerMode] = useState<"add" | "move">("add");
  const [pickerNote, setPickerNote] = useState<VaultNote | null>(null);

  function handleNoteContext(e: React.MouseEvent, note: VaultNote) {
    const noteBinIds = noteBins?.get(note.id) ?? [];
    const sourceUnambiguous =
      (currentBinId !== null && currentBinId !== undefined) || noteBinIds.length === 1;

    const items: Array<{ label: string; action: () => void; danger?: boolean }> = [
      { label: "Open", action: () => onNoteClick(note) },
      {
        label: "Add to bin…",
        action: () => {
          setPickerMode("add");
          setPickerNote(note);
          setPickerOpen(true);
        },
      },
    ];
    if (sourceUnambiguous) {
      items.push({
        label: "Move to bin…",
        action: () => {
          setPickerMode("move");
          setPickerNote(note);
          setPickerOpen(true);
        },
      });
    }
    if (currentBinId) {
      items.push({
        label: "Remove from this bin",
        action: async () => {
          try {
            const res = await fetch(`/api/bins/${currentBinId}/assign/${note.id}`, {
              method: "DELETE",
            });
            if (!res.ok) throw new Error(`Remove failed (${res.status})`);
            show(`Removed from '${currentBinName ?? "bin"}'`, "info");
            onMutated?.();
          } catch (err) {
            show(err instanceof Error ? err.message : "Remove failed", "error");
          }
        },
        danger: true,
      });
    }
    menu.open(e, items);
  }

  if (notes.length === 0) {
    return <div className="text-xs text-text-muted px-2 py-8 text-center">{emptyMessage}</div>;
  }

  return (
    <>
      <ul className="flex flex-col">
        {notes.map((n) => (
          <NoteRow
            key={n.id}
            note={n}
            isSelected={n.vault_path === selectedPath}
            currentBinId={currentBinId ?? null}
            noteBins={noteBins}
            onNoteClick={onNoteClick}
            onContext={handleNoteContext}
          />
        ))}
      </ul>
      {pickerNote && (
        <BinPicker
          open={pickerOpen}
          title={pickerMode === "add" ? "Add to bin…" : "Move to bin…"}
          onClose={() => {
            setPickerOpen(false);
            setPickerNote(null);
          }}
          alreadyInIds={noteBins?.get(pickerNote.id) ?? []}
          disableAlreadyIn={pickerMode === "add"}
          onPick={async (targetId) => {
            if (!targetId) return;
            try {
              if (pickerMode === "add") {
                const res = await fetch(`/api/bins/${targetId}/assign`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ note_id: pickerNote.id }),
                });
                if (!res.ok) throw new Error(`Add failed (${res.status})`);
                show("Added to bin", "info");
              } else {
                const fromBinId = currentBinId ?? (noteBins?.get(pickerNote.id) ?? [])[0];
                if (!fromBinId) throw new Error("No source bin to move from");
                const res = await fetch(`/api/notes/${pickerNote.id}/move`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ from_bin_id: fromBinId, to_bin_id: targetId }),
                });
                if (!res.ok) throw new Error(`Move failed (${res.status})`);
                show("Moved to bin", "info");
              }
              onMutated?.();
            } catch (err) {
              show(err instanceof Error ? err.message : "Failed", "error");
            }
          }}
        />
      )}
    </>
  );
}

interface NoteRowProps {
  note: VaultNote;
  isSelected: boolean;
  currentBinId: string | null;
  noteBins?: Map<string, string[]>;
  onNoteClick: (note: VaultNote) => void;
  onContext: (e: React.MouseEvent, note: VaultNote) => void;
}

function NoteRow({ note, isSelected, currentBinId, noteBins, onNoteClick, onContext }: NoteRowProps) {
  const dragProps = useDrag(() => ({
    kind: "note" as const,
    id: note.id,
    contextBinId: currentBinId,
  }));
  const binCount = noteBins?.get(note.id)?.length ?? 0;
  return (
    <li
      key={note.id}
      {...dragProps}
      onContextMenu={(e) => onContext(e, note)}
    >
      <button
        onClick={() => onNoteClick(note)}
        className={`w-full text-left px-5 py-2.5 border-b border-border-subtle flex items-center gap-3 ${
          isSelected
            ? "bg-accent-tint border-l-2 border-l-accent"
            : "hover:bg-hover"
        }`}
      >
        <span className="text-xs text-text-primary flex-1 truncate">{note.title}</span>
        {binCount > 1 && (
          <span className="mono text-2xs text-text-secondary">·{binCount}</span>
        )}
        <span className="mono text-2xs text-text-subtle">{sourceLabels[note.source]}</span>
        <span className="mono text-2xs text-text-subtle w-16 text-right">{relTime(note.modified_at)}</span>
      </button>
    </li>
  );
}
