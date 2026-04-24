import { Card, CardHeader } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import { ProjectClientSelect } from "@/components/ProjectClientSelect";
import { RetiredBanner } from "@/components/RetiredBanner";
import { listProjects } from "@/lib/queries/projects";
import { listClients } from "@/lib/queries/clients";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default function ProjectsPage() {
  const projects = listProjects();
  const clients = listClients();

  const assigned = projects.filter((p) => p.client_id).length;
  const unassigned = projects.length - assigned;

  return (
    <div>
      <RetiredBanner />
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Projects</h1>
        <p className="text-xs text-text-muted mt-0.5">
          {projects.length} total · {assigned} assigned · {unassigned} unassigned
        </p>
      </div>

      {projects.length === 0 ? (
        <Card>
          <p className="text-xs text-text-muted">
            No projects indexed yet. Run <span className="mono">npm run sync:projects</span> to scan ~/Work.
          </p>
        </Card>
      ) : (
        <Card>
          <CardHeader
            label="All Projects"
            right={<span className="text-2xs text-text-muted">{projects.length} repos</span>}
          />
          <div className="flex flex-col">
            <div className="grid grid-cols-[auto_1.6fr_0.8fr_0.9fr_1fr] gap-4 px-3 py-2 text-2xs uppercase tracking-wider text-text-muted border-b border-hover">
              <div className="w-2"></div>
              <div>Project</div>
              <div>Branch</div>
              <div>Last Commit</div>
              <div>Client</div>
            </div>
            {projects.map((p) => {
              const isRecent =
                p.last_commit_at && new Date(p.last_commit_at).getTime() > Date.now() - 86400000;
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-[auto_1.6fr_0.8fr_0.9fr_1fr] gap-4 px-3 py-3 items-center border-b border-hover last:border-0"
                >
                  <StatusDot status={isRecent ? "green" : "gray"} size={7} />
                  <div className="min-w-0">
                    <div className="text-xs text-text-primary font-medium truncate" title={p.name}>{p.name}</div>
                    <div className="mono text-[10px] text-text-muted truncate" title={p.path}>{p.path}</div>
                  </div>
                  <div className="mono text-[10px] text-text-secondary">{p.branch ?? "—"}</div>
                  <div className="text-[10px] text-text-secondary">
                    {p.last_commit_at ? formatRelativeTime(p.last_commit_at) : "no commits"}
                  </div>
                  <ProjectClientSelect
                    projectId={p.id}
                    currentClientId={p.client_id}
                    clients={clients}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
