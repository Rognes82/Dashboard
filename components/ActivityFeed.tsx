import { Card, CardHeader } from "./Card";
import { formatRelativeTime, activityBorderColor } from "@/lib/utils";
import type { ActivityEntry } from "@/lib/types";

export function ActivityFeed({ items }: { items: ActivityEntry[] }) {
  return (
    <Card>
      <CardHeader label="Recent Activity" />
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">No activity yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((a) => (
            <div key={a.id} className={`border-l-2 pl-2.5 ${activityBorderColor(a.source)}`}>
              <div className="text-xs text-text-primary">{a.title}</div>
              <div className="mono text-[10px] text-text-muted">
                {formatRelativeTime(a.timestamp)} · {a.source}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
