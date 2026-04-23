"use client";

import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card, CardHeader } from "@/components/Card";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Badge } from "@/components/Badge";
import { formatRelativeTime } from "@/lib/utils";
import type { VaultNote, Bin } from "@/lib/types";

interface NoteDetail {
  note: VaultNote;
  content: string;
  bins: Bin[];
}

export default function NoteDetailPage({ params }: { params: { id: string } }) {
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    fetch(`/api/notes/${params.id}`)
      .then(async (r) => {
        if (r.status === 404) {
          setStatus("missing");
          return;
        }
        if (!r.ok) {
          setStatus("error");
          return;
        }
        const data = (await r.json()) as NoteDetail;
        setDetail(data);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, [params.id]);

  if (status === "missing") notFound();
  if (status === "loading" || !detail) {
    return <div className="text-xs text-text-muted">Loading note…</div>;
  }
  if (status === "error") {
    return <div className="text-xs text-red-400">Could not load this note.</div>;
  }

  const { note, content, bins } = detail;
  const frontmatterSplit = content.split(/^---\s*$/m);
  const body = frontmatterSplit.length >= 3 ? frontmatterSplit.slice(2).join("---").trim() : content;

  return (
    <div>
      <Breadcrumb items={[{ label: "Notes", href: "/notes" }, { label: note.title }]} />

      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="mono text-lg font-semibold text-text-primary">{note.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge>{note.source}</Badge>
            <span className="text-[10px] text-text-muted mono">{note.vault_path}</span>
            <span className="text-[10px] text-text-muted">·</span>
            <span className="text-[10px] text-text-muted">{formatRelativeTime(note.modified_at)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {note.source_url && (
            <a
              href={note.source_url}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] mono border border-border rounded px-2 py-1 hover:bg-hover"
            >
              Open in {note.source}
            </a>
          )}
          <a
            href={`obsidian://open?path=${encodeURIComponent(note.vault_path)}`}
            className="text-[10px] mono border border-border rounded px-2 py-1 hover:bg-hover"
          >
            Open in Obsidian
          </a>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_240px] gap-4">
        <Card>
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
          </div>
        </Card>
        <aside className="flex flex-col gap-3">
          <Card>
            <CardHeader label="In bins" />
            {bins.length === 0 ? (
              <p className="text-xs text-text-muted">Not assigned to any bin.</p>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {bins.map((b) => (
                  <li key={b.id} className="text-[10px] bg-hover px-2 py-1 rounded">
                    {b.name}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-text-muted mt-3">
              Bin membership is managed here. Edits to the `bins:` frontmatter field in the file have no effect after initial creation.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
