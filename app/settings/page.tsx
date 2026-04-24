"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/Card";
import { AddClientForm } from "@/components/AddClientForm";
import { ActionButton } from "@/components/ActionButton";
import { SyncHealth } from "@/components/SyncHealth";
import type { Client, SyncStatusRecord } from "@/lib/types";

export default function SettingsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [notionTargets, setNotionTargets] = useState<string[]>([]);
  const [targetsInput, setTargetsInput] = useState("");
  const [sync, setSync] = useState<SyncStatusRecord[]>([]);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients").then((r) => r.json()).then((d) => setClients(d.clients ?? []));
    fetch("/api/settings/notion-targets")
      .then((r) => r.json())
      .then((d) => {
        const t = d.targets ?? [];
        setNotionTargets(t);
        setTargetsInput(t.join("\n"));
      });
    fetch("/api/system").then((r) => r.json()).then((d) => setSync(d.sync ?? []));
  }, []);

  async function saveTargets() {
    setSaveStatus(null);
    const list = targetsInput
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const res = await fetch("/api/settings/notion-targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: list }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSaveStatus(`Error: ${data.error ?? "save failed"}`);
      return;
    }
    setNotionTargets(data.targets);
    setSaveStatus("Saved ✓");
    setTimeout(() => setSaveStatus(null), 2000);
  }

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

        <Card>
          <CardHeader label="Notion Sync Targets" right={<span className="text-2xs text-text-muted">{notionTargets.length}</span>} />
          <p className="text-[10px] text-text-muted mb-2">
            Paste Notion database IDs (one per line). Each must be shared with your integration in Notion.
          </p>
          <textarea
            value={targetsInput}
            onChange={(e) => setTargetsInput(e.target.value)}
            rows={5}
            placeholder="abc123def456..."
            className="w-full bg-base border border-border rounded p-2 text-xs text-text-primary font-mono focus:border-accent-green focus:outline-none"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={saveTargets}
              className="bg-accent-green text-black text-xs font-medium px-3 py-1.5 rounded hover:bg-accent-green/90"
            >
              Save
            </button>
            {saveStatus && <span className="text-[10px] text-text-muted">{saveStatus}</span>}
          </div>
        </Card>

        <Card>
          <CardHeader label="Actions" />
          <div className="flex flex-col gap-2">
            <ActionButton label="Run vault indexer" endpoint="/api/actions/reindex" />
            <ActionButton
              label="Re-seed bins from folders"
              endpoint="/api/actions/seed-bins"
              confirm="This will re-apply automatic bin assignments based on folder locations. Manual assignments are preserved, but notes that currently have no bins may be auto-assigned. Continue?"
            />
          </div>
          <p className="text-[10px] text-text-muted mt-3">
            Notion sync runs on cron. To trigger manually, run <code className="mono">npm run sync:notion</code> in the project directory.
          </p>
        </Card>

        <div className="col-span-2">
          <SyncHealth items={sync} />
        </div>
      </div>
    </div>
  );
}
