"use client";

import { useEffect, useRef, useState } from "react";
import type { BinNode } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCaptured?: (noteId: string | null) => void;
}

function flattenBins(nodes: BinNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = [];
  for (const n of nodes) {
    out.push({ id: n.id, name: n.name, depth });
    out.push(...flattenBins(n.children, depth + 1));
  }
  return out;
}

export function QuickCapture({ open, onClose, onCaptured }: Props) {
  const [bins, setBins] = useState<BinNode[]>([]);
  const [content, setContent] = useState("");
  const [binId, setBinId] = useState<string>("");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/bins")
      .then((r) => r.json())
      .then((d) => {
        const flat = flattenBins(d.bins ?? []);
        setBins(d.bins ?? []);
        if (flat[0]) setBinId((prev) => prev || flat[0].id);
      });
  }, [open]);

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 30);
    else {
      setContent("");
      setTags("");
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    setError(null);
    if (!content.trim()) {
      setError("Content required");
      return;
    }
    if (!binId) {
      setError("Pick a bin");
      return;
    }
    setSubmitting(true);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await fetch("/api/notes/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim(), bin_id: binId, tags: tagList }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Capture failed");
        return;
      }
      onCaptured?.(data.note_id ?? null);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture failed");
    } finally {
      setSubmitting(false);
    }
  }

  const flat = flattenBins(bins);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-[min(640px,90vw)] p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="mono text-sm font-semibold text-text-primary">Quick Capture</h2>
          <button
            onClick={onClose}
            className="text-[10px] text-text-muted hover:text-text-primary mono"
            aria-label="Close capture dialog"
          >
            Esc
          </button>
        </div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape") {
              onClose();
            }
          }}
          placeholder="What's on your mind?"
          rows={6}
          className="w-full bg-base border border-border rounded p-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-green focus:outline-none resize-none"
        />
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-muted uppercase mono">Bin</span>
            <select
              value={binId}
              onChange={(e) => setBinId(e.target.value)}
              className="bg-base border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:border-accent-green focus:outline-none"
            >
              {flat.length === 0 && <option value="">(no bins yet)</option>}
              {flat.map((b) => (
                <option key={b.id} value={b.id}>
                  {"— ".repeat(b.depth)}
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-muted uppercase mono">Tags (comma-sep)</span>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="idea, inbox"
              className="bg-base border border-border rounded px-2 py-1.5 text-xs text-text-primary focus:border-accent-green focus:outline-none"
            />
          </label>
        </div>
        {error && <div className="text-[10px] text-red-400">{error}</div>}
        <div className="flex items-center justify-between pt-1">
          <div className="text-[10px] text-text-muted mono">⌘⏎ to submit · Esc to cancel</div>
          <button
            onClick={submit}
            disabled={submitting}
            className="bg-accent-green text-black text-xs font-medium px-3 py-1.5 rounded hover:bg-accent-green/90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Capture"}
          </button>
        </div>
      </div>
    </div>
  );
}
