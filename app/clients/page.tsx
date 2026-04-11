import Link from "next/link";
import { Card } from "@/components/Card";
import { StatusDot } from "@/components/StatusDot";
import { Badge } from "@/components/Badge";
import { listClients } from "@/lib/queries/clients";

export const dynamic = "force-dynamic";

const statusToDot = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "gray";
  return "gray";
};

export default function ClientsListPage() {
  const clients = listClients();

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Clients</h1>
        <p className="text-xs text-text-muted mt-0.5">{clients.length} total</p>
      </div>

      {clients.length === 0 ? (
        <Card>
          <p className="text-xs text-text-muted">No clients yet. Add one in Settings.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/clients/${c.slug}`}>
              <Card className="hover:bg-hover transition-colors cursor-pointer">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 bg-hover border border-border rounded-md flex items-center justify-center">
                    <span className="mono text-base font-semibold text-text-primary">
                      {c.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="mono text-sm font-semibold text-text-primary">{c.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusDot status={statusToDot(c.status)} size={6} />
                      <span className="text-[10px] text-text-muted capitalize">{c.status}</span>
                    </div>
                  </div>
                </div>
                {c.pipeline_stage && <Badge>{c.pipeline_stage}</Badge>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
