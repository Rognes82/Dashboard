"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { VaultNote, Bin } from "@/lib/types";
import { CloseIcon, ExternalIcon } from "./icons";

interface Detail {
  note: VaultNote;
  content: string;
  bins: Bin[];
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400_000);
  if (d === 0) return "today";
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

export function ReadingPane({ path, onClose }: { path: string; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetch(`/api/notes/by-path?path=${encodeURIComponent(path)}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setError(d.error ?? `HTTP ${r.status}`);
          return;
        }
        setDetail(await r.json());
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [path]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fmEnd = detail ? detail.content.lastIndexOf("---") : -1;
  const body =
    detail && detail.content.startsWith("---") && fmEnd > 0
      ? detail.content.slice(fmEnd + 3).trim()
      : detail?.content ?? "";

  return (
    <aside
      className="fixed right-0 top-0 bottom-0 w-[340px] bg-raised border-l border-border-default z-20 flex flex-col"
      role="complementary"
      aria-label="Reading pane"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <span className="mono text-2xs text-text-dim">reading</span>
        {detail?.note.source_url && (
          <a
            href={detail.note.source_url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-accent hover:opacity-80"
            aria-label={`Open in ${detail.note.source}`}
          >
            <ExternalIcon size={12} />
          </a>
        )}
        {detail && (
          <a
            href={`obsidian://open?path=${encodeURIComponent(detail.note.vault_path)}`}
            className={`${detail.note.source_url ? "" : "ml-auto"} text-accent hover:opacity-80`}
            aria-label="Open in Obsidian"
          >
            <ExternalIcon size={12} />
          </a>
        )}
        <button onClick={onClose} aria-label="Close pane" className="text-text-muted hover:text-text-primary">
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error && <div className="text-2xs text-red-400">{error}</div>}
        {!detail && !error && <div className="text-2xs text-text-muted">Loading…</div>}
        {detail && (
          <>
            <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1.5">
              {detail.note.source} · {relTime(detail.note.modified_at)}
            </div>
            <h2 className="text-base text-text-primary font-medium mb-3">{detail.note.title}</h2>
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
            {detail.bins.length > 0 && (
              <>
                <div className="mono text-2xs text-text-muted uppercase tracking-wider mt-6 mb-2">
                  In bins
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {detail.bins.map((b) => (
                    <span
                      key={b.id}
                      className="mono text-2xs px-2 py-1 bg-hover border border-border-default rounded-sm text-text-secondary"
                    >
                      {b.name}
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
