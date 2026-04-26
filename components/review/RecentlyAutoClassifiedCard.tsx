"use client";
import { useState } from "react";

export interface RecentRow {
  id: string;
  note_id: string;
  note_title: string;
  action: "auto_assign" | "auto_create_bin";
  bin_name: string | null;
  new_bin_path: string | null;
  existing_confidence: number | null;
  new_bin_rating: number | null;
  reasoning: string | null;
  created_at: number;
}

interface Props {
  rows: RecentRow[];
  onChanged: () => void;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function Row({ row, onChanged }: { row: RecentRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [showReason, setShowReason] = useState(false);

  async function undo(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/classify/auto/${row.id}/undo`, { method: "POST" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const score =
    row.action === "auto_create_bin"
      ? row.new_bin_rating?.toFixed(2)
      : row.existing_confidence?.toFixed(2);

  return (
    <div className="border-b border-white/5 last:border-0 py-2">
      <div className="flex items-baseline justify-between font-mono text-sm">
        <span className="text-white/80">{row.note_title}</span>
        <span className="text-white/40 text-xs">
          auto · {row.action === "auto_create_bin" ? "created bin · " : ""}
          {relativeTime(row.created_at)}
        </span>
      </div>
      <div className="mt-1 font-mono text-xs flex items-center gap-2">
        {row.action === "auto_create_bin" ? (
          <span className="text-cyan-400">+ {row.new_bin_path} (created)</span>
        ) : (
          <>
            <span className="text-white/60">→</span>
            <span className="text-white/70">{row.bin_name}</span>
          </>
        )}
        <span className="text-white/40">({score})</span>
        <button onClick={() => setShowReason((v) => !v)} className="ml-auto text-white/40 hover:text-white/70">
          {showReason ? "hide" : "show reasoning ▾"}
        </button>
        <button disabled={busy} onClick={undo}
          className="text-white/40 hover:text-amber-300">
          Undo
        </button>
      </div>
      {showReason && row.reasoning && (
        <div className="mt-1 text-xs text-white/60 italic">{row.reasoning}</div>
      )}
    </div>
  );
}

export function RecentlyAutoClassifiedCard({ rows, onChanged }: Props) {
  if (rows.length === 0) return null;
  return (
    <section className="border border-white/10 rounded p-4 mb-4">
      <h2 className="font-mono text-sm text-white/70 mb-3">
        Recently auto-classified ({rows.length})
      </h2>
      {rows.map((r) => (
        <Row key={r.id} row={r} onChanged={onChanged} />
      ))}
    </section>
  );
}
