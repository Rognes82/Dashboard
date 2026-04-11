import { Card, CardHeader } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import { SyncHealth } from "@/components/SyncHealth";
import { listAgents } from "@/lib/queries/agents";
import { listSyncStatuses } from "@/lib/queries/sync-status";
import { formatRelativeTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

const agentStatusToDot = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "running") return "green";
  if (status === "errored") return "red";
  if (status === "stopped") return "gray";
  return "gray";
};

export default function AgentsSystemPage() {
  const agents = listAgents();
  const sync = listSyncStatuses();

  const cronJobs = agents.filter((a) => a.type === "cron");
  const discordBots = agents.filter((a) => a.type === "discord_bot");
  const otherAgents = agents.filter((a) => a.type !== "cron" && a.type !== "discord_bot");

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Agents &amp; System</h1>
        <p className="text-xs text-text-muted mt-0.5">Mac Mini · via Tailscale</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Agents */}
        <Card>
          <CardHeader
            label="Agents"
            right={<span className="text-2xs text-accent-green font-medium">{otherAgents.filter((a) => a.status === "running").length} running</span>}
          />
          {otherAgents.length === 0 ? (
            <p className="text-xs text-text-muted">No agents registered yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {otherAgents.map((a) => (
                <div key={a.id} className="flex items-center justify-between bg-base rounded p-2.5">
                  <div className="flex items-center gap-2.5">
                    <StatusDot status={agentStatusToDot(a.status)} />
                    <div>
                      <div className="text-xs text-text-primary font-medium">{a.name}</div>
                      <div className="mono text-[10px] text-text-muted">
                        {a.type} {a.schedule ? `· ${a.schedule}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {a.last_run_at ? formatRelativeTime(a.last_run_at) : "never"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Discord Bots */}
        <Card>
          <CardHeader
            label="Discord Bots"
            right={<span className="text-2xs text-accent-green font-medium">{discordBots.filter((a) => a.status === "running").length} online</span>}
          />
          {discordBots.length === 0 ? (
            <p className="text-xs text-text-muted">No bots registered yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {discordBots.map((a) => (
                <div key={a.id}>
                  <div className="flex items-center justify-between bg-base rounded p-2.5">
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={agentStatusToDot(a.status)} />
                      <div>
                        <div className="text-xs text-text-primary font-medium">{a.name}</div>
                        <div className="mono text-[10px] text-text-muted">{a.schedule ?? "on event"}</div>
                      </div>
                    </div>
                  </div>
                  {a.last_output && (
                    <div className="mono text-[10px] text-text-secondary bg-base border-l-2 border-border rounded p-2.5 mt-1 whitespace-pre-wrap">
                      {a.last_output}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-[1.4fr_0.6fr] gap-3">
        {/* Cron jobs */}
        <Card>
          <CardHeader label="Cron Jobs (Mac Mini)" />
          {cronJobs.length === 0 ? (
            <p className="text-xs text-text-muted">No cron jobs registered yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[1fr_1.2fr_0.6fr_0.5fr] gap-2 px-3 text-2xs uppercase tracking-wider text-text-muted">
                <div>Job</div>
                <div>Schedule</div>
                <div>Last Run</div>
                <div>Status</div>
              </div>
              {cronJobs.map((a) => (
                <div
                  key={a.id}
                  className="grid grid-cols-[1fr_1.2fr_0.6fr_0.5fr] gap-2 p-3 bg-base rounded items-center"
                >
                  <div className="text-xs text-text-primary">{a.name}</div>
                  <div className="mono text-[10px] text-text-secondary">{a.schedule ?? "—"}</div>
                  <div className="text-[10px] text-text-secondary">
                    {a.last_run_at ? formatRelativeTime(a.last_run_at) : "never"}
                  </div>
                  <div>
                    <StatusDot status={agentStatusToDot(a.status)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <SyncHealth items={sync} />
      </div>
    </div>
  );
}
