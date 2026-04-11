import { StatCard } from "@/components/StatCard";
import { ClientPipeline } from "@/components/ClientPipeline";
import { ActivityFeed } from "@/components/ActivityFeed";
import { listClients } from "@/lib/queries/clients";
import { listAgents } from "@/lib/queries/agents";
import { listRecentActivity } from "@/lib/queries/activity";
import { listFiles } from "@/lib/queries/files";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const clients = listClients();
  const agents = listAgents();
  const activity = listRecentActivity(10);
  const files = listFiles(1000);

  const activeClients = clients.filter((c) => c.status === "active").length;
  const runningAgents = agents.filter((a) => a.status === "running").length;
  const cronJobs = agents.filter((a) => a.type === "cron").length;

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Dashboard</h1>
        <p className="text-xs text-text-muted mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-3">
        <StatCard label="Clients" value={clients.length} subtext={`${activeClients} active`} subtextColor="green" />
        <StatCard label="Agents" value={runningAgents} subtext="running" />
        <StatCard label="Cron Jobs" value={cronJobs} subtext="scheduled" />
        <StatCard label="Files" value={files.length} subtext="indexed" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ClientPipeline clients={clients} />
        <ActivityFeed items={activity} />
      </div>
    </div>
  );
}
