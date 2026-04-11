import { Card, CardHeader } from "./Card";
import { StatusDot } from "./StatusDot";
import { Badge } from "./Badge";
import type { Client } from "@/lib/types";

const statusToDot = (status: string): "green" | "amber" | "red" | "gray" => {
  if (status === "active") return "green";
  if (status === "paused") return "amber";
  if (status === "completed") return "gray";
  return "gray";
};

export function ClientPipeline({ clients }: { clients: Client[] }) {
  return (
    <Card>
      <CardHeader label="Client Pipeline" />
      {clients.length === 0 ? (
        <p className="text-xs text-text-muted">No clients yet. Add one in Settings.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {clients.map((c) => (
            <div key={c.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={statusToDot(c.status)} />
                <span className="text-xs text-text-primary font-medium">{c.name}</span>
              </div>
              {c.pipeline_stage && <Badge>{c.pipeline_stage}</Badge>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
