import { Card, CardHeader } from "./Card";
import type { SyncStatusRecord } from "@/lib/types";

export function SyncHealth({ items }: { items: SyncStatusRecord[] }) {
  return (
    <Card>
      <CardHeader label="Sync Health" />
      {items.length === 0 ? (
        <p className="text-xs text-text-muted">No sync runs yet.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((s) => {
            const isOk = s.status === "ok";
            const label = s.sync_name.replace(/^sync-/, "").replace(/-/g, " ");
            return (
              <div key={s.sync_name}>
                <div className="flex justify-between mb-1">
                  <span className="text-xs text-text-primary capitalize">{label}</span>
                  <span className={`text-2xs ${isOk ? "text-accent-green" : "text-accent-amber"}`}>
                    {s.status}
                  </span>
                </div>
                <div className="h-[3px] bg-hover rounded-sm">
                  <div
                    className={`h-full rounded-sm ${isOk ? "bg-accent-green w-full" : "bg-accent-amber w-2/5"}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
