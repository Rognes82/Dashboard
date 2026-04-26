"use client";
import { useState } from "react";

export interface ProposalRowProps {
  id: string;
  noteTitle: string;
  noteId: string;
  existingBinPath: string | null;
  existingConfidence: number;
  newBinPath: string | null;
  newBinRating: number | null;
  reasoning: string;
  onChanged: () => void;
}

async function patch(id: string, body: unknown): Promise<void> {
  const res = await fetch(`/api/classify/proposals/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function setSkip(noteId: string, skip: boolean): Promise<void> {
  await fetch(`/api/notes/${noteId}/classifier-skip`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skip }),
  });
}

export function PendingProposalRow(props: ProposalRowProps) {
  const [busy, setBusy] = useState(false);
  const [showReason, setShowReason] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(props.newBinPath ?? "");

  const isNewBin = props.newBinPath !== null;

  async function doAction(body: unknown): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await patch(props.id, body);
      props.onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function doSkip(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await setSkip(props.noteId, true);
      props.onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-white/10 rounded p-3 mb-2 bg-white/[0.02]">
      <div className="font-mono text-sm text-white/90">{props.noteTitle}</div>
      <div className="font-mono text-xs mt-1">
        {isNewBin ? (
          <>
            <span className="text-cyan-400">+ create</span>{" "}
            <span className="text-white/80">{props.newBinPath}</span>{" "}
            <span className="text-white/50">(rating {props.newBinRating?.toFixed(2)})</span>
            {props.existingBinPath && (
              <div className="text-white/50 mt-1">
                best existing match: {props.existingBinPath} ({props.existingConfidence.toFixed(2)})
              </div>
            )}
          </>
        ) : (
          <>
            <span className="text-white/60">→</span>{" "}
            <span className="text-white/80">{props.existingBinPath ?? "(no match)"}</span>{" "}
            <span className="text-white/50">({props.existingConfidence.toFixed(2)})</span>
          </>
        )}
        <button
          className="ml-3 text-white/50 hover:text-white/80"
          onClick={() => setShowReason((v) => !v)}
        >
          {showReason ? "hide reasoning" : "show reasoning ▾"}
        </button>
      </div>
      {showReason && (
        <div className="mt-2 text-xs text-white/70 italic">{props.reasoning}</div>
      )}
      {editingPath && (
        <div className="mt-2 flex gap-2">
          <input
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            className="flex-1 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          />
          <button
            disabled={busy}
            onClick={() => doAction({ action: "accept_new_bin", path: pathInput })}
            className="px-2 py-1 text-xs border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10"
          >
            Save
          </button>
          <button
            disabled={busy}
            onClick={() => setEditingPath(false)}
            className="px-2 py-1 text-xs border border-white/20 text-white/60 rounded"
          >
            Cancel
          </button>
        </div>
      )}
      {!editingPath && (
        <div className="mt-2 flex gap-2 text-xs">
          {isNewBin ? (
            <button disabled={busy} onClick={() => doAction({ action: "accept" })}
              className="px-2 py-1 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10">
              Accept &amp; create
            </button>
          ) : (
            <button disabled={busy} onClick={() => doAction({ action: "accept" })}
              className="px-2 py-1 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10">
              Accept
            </button>
          )}
          {isNewBin && (
            <button disabled={busy} onClick={() => setEditingPath(true)}
              className="px-2 py-1 border border-white/20 text-white/70 rounded hover:bg-white/5">
              Edit path…
            </button>
          )}
          <button disabled={busy} onClick={() => doAction({ action: "reject" })}
            className="px-2 py-1 border border-white/20 text-white/70 rounded hover:bg-white/5">
            Reject
          </button>
          <button disabled={busy} onClick={doSkip}
            className="px-2 py-1 border border-amber-500/30 text-amber-300/80 rounded hover:bg-amber-500/10">
            Stop trying
          </button>
        </div>
      )}
    </div>
  );
}
