import { Card, CardHeader } from "@/components/Card";
import { AddClientForm } from "@/components/AddClientForm";
import { listClients } from "@/lib/queries/clients";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const clients = listClients();

  return (
    <div>
      <div className="mb-5">
        <h1 className="mono text-lg font-semibold text-text-primary">Settings</h1>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader label="Add Client" />
          <AddClientForm />
        </Card>

        <Card>
          <CardHeader label="Current Clients" right={<span className="text-2xs text-text-muted">{clients.length}</span>} />
          {clients.length === 0 ? (
            <p className="text-xs text-text-muted">No clients yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {clients.map((c) => (
                <div key={c.id} className="flex items-center justify-between bg-base rounded p-2.5">
                  <div>
                    <div className="text-xs text-text-primary font-medium">{c.name}</div>
                    <div className="mono text-[10px] text-text-muted">{c.slug}</div>
                  </div>
                  <span className="text-[10px] text-text-secondary capitalize">{c.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
