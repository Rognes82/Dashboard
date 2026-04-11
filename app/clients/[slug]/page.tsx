import { notFound } from "next/navigation";
import { Card, CardHeader } from "@/components/Card";
import { Breadcrumb } from "@/components/Breadcrumb";
import { Badge } from "@/components/Badge";
import { StatusDot } from "@/components/StatusDot";
import { formatRelativeTime } from "@/lib/utils";
import { getClientBySlug } from "@/lib/queries/clients";
import { listProjectsByClient } from "@/lib/queries/projects";
import { listFilesByClient } from "@/lib/queries/files";
import { listNotesByClient } from "@/lib/queries/notes";
import { listActivityByClient } from "@/lib/queries/activity";

export const dynamic = "force-dynamic";

const statusToBadge = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "gray";
  return "gray";
};

export default function ClientHubPage({ params }: { params: { slug: string } }) {
  const client = getClientBySlug(params.slug);
  if (!client) notFound();

  const projects = listProjectsByClient(client.id);
  const files = listFilesByClient(client.id, 5);
  const notes = listNotesByClient(client.id, 5);
  const activity = listActivityByClient(client.id, 10);

  return (
    <div>
      <Breadcrumb items={[{ label: "Clients", href: "/clients" }, { label: client.name }]} />

      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-hover border border-border rounded-md flex items-center justify-center">
            <span className="mono text-base font-semibold text-text-primary">
              {client.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <div className="mono text-lg font-semibold text-text-primary">{client.name}</div>
            <div className="text-xs text-text-muted mt-0.5">
              Client since {new Date(client.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
        {client.pipeline_stage && (
          <Badge variant={statusToBadge(client.status)}>{client.pipeline_stage}</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Projects */}
        <Card>
          <CardHeader label="Projects" right={<span className="text-2xs text-text-muted">{projects.length} total</span>} />
          {projects.length === 0 ? (
            <p className="text-xs text-text-muted">No projects linked yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between bg-base rounded p-2.5">
                  <div>
                    <div className="text-xs text-text-primary font-medium">{p.name}</div>
                    <div className="mono text-[10px] text-text-muted">
                      {p.branch ?? "—"} · {p.last_commit_at ? formatRelativeTime(p.last_commit_at) : "no commits"}
                    </div>
                  </div>
                  <StatusDot
                    status={p.last_commit_at && new Date(p.last_commit_at).getTime() > Date.now() - 86400000 ? "green" : "gray"}
                    size={7}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Recent Files */}
        <Card>
          <CardHeader label="Recent Files" right={<span className="text-2xs text-text-muted">View all</span>} />
          {files.length === 0 ? (
            <p className="text-xs text-text-muted">No files linked yet.</p>
          ) : (
            <div>
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-2.5 py-2 border-b border-hover last:border-0">
                  <div className="flex-1">
                    <div className="text-xs text-text-primary">{f.name}</div>
                    <div className="text-[10px] text-text-muted capitalize">
                      {f.source.replace("_", " ")} · {f.modified_at ? formatRelativeTime(f.modified_at) : "unknown"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader label="Notes" right={<span className="text-2xs text-text-muted">{notes.length} total</span>} />
          {notes.length === 0 ? (
            <p className="text-xs text-text-muted">No notes linked yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {notes.map((n) => (
                <div key={n.id} className="bg-base rounded p-2.5">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-xs text-text-primary font-medium">{n.title}</span>
                    <span className="text-[9px] bg-hover px-1.5 py-0.5 rounded-sm text-text-muted capitalize">
                      {n.source.replace("_", " ")}
                    </span>
                  </div>
                  {n.content_preview && (
                    <div className="text-[10px] text-text-secondary line-clamp-2">{n.content_preview}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Activity */}
        <Card>
          <CardHeader label="Activity" />
          {activity.length === 0 ? (
            <p className="text-xs text-text-muted">No activity yet.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {activity.map((a) => (
                <div key={a.id} className="border-l-2 border-accent-green pl-2.5">
                  <div className="text-xs text-text-primary">{a.title}</div>
                  <div className="mono text-[10px] text-text-muted">
                    {formatRelativeTime(a.timestamp)} · {a.source}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
