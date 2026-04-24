import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { RetiredBanner } from "@/components/RetiredBanner";
import { listFiles } from "@/lib/queries/files";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function FilesPage() {
  const files = listFiles(500);

  return (
    <div>
      <RetiredBanner />
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Files</h1>
        <p className="text-xs text-text-muted mt-0.5">{files.length} files indexed</p>
      </div>

      <Card>
        {files.length === 0 ? (
          <p className="text-xs text-text-muted">No files indexed yet. Run sync-projects or configure Drive sync.</p>
        ) : (
          <div className="flex flex-col">
            {files.map((f) => (
              <div
                key={f.id}
                className="grid grid-cols-[1fr_auto_auto] gap-4 py-2.5 border-b border-hover last:border-0 items-center"
              >
                <div>
                  <div className="text-xs text-text-primary">{f.name}</div>
                  <div className="text-[10px] text-text-muted mono">{f.path}</div>
                </div>
                <Badge>{f.source}</Badge>
                <div className="text-[10px] text-text-secondary">
                  {f.modified_at ? formatRelativeTime(f.modified_at) : "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
