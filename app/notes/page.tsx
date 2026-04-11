import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { listNotes } from "@/lib/queries/notes";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function NotesPage() {
  const notes = listNotes(200);

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Notes</h1>
        <p className="text-xs text-text-muted mt-0.5">{notes.length} notes aggregated</p>
      </div>

      {notes.length === 0 ? (
        <Card>
          <p className="text-xs text-text-muted">
            No notes aggregated yet. Notion, Apple Notes, and Obsidian sync are deferred to v2.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {notes.map((n) => (
            <Card key={n.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm text-text-primary font-medium">{n.title}</span>
                <Badge>{n.source.replace("_", " ")}</Badge>
              </div>
              {n.content_preview && (
                <p className="text-xs text-text-secondary line-clamp-3">{n.content_preview}</p>
              )}
              <div className="text-[10px] text-text-muted mono mt-2">
                {n.modified_at ? formatRelativeTime(n.modified_at) : "—"}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
