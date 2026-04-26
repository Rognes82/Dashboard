"use client";

import { useEffect, useState } from "react";
import { ProfileCard, type ProfileDisplay } from "@/components/settings/ProfileCard";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { ClassifierSettings } from "@/components/settings/ClassifierSettings";
import { ActionButton } from "@/components/ActionButton";
import type { SyncStatusRecord } from "@/lib/types";

export default function SettingsPage() {
  const [profiles, setProfiles] = useState<ProfileDisplay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProfileDisplay | null>(null);
  const [adding, setAdding] = useState(false);
  const [targets, setTargets] = useState<string>("");
  const [targetsStatus, setTargetsStatus] = useState<string | null>(null);
  const [sync, setSync] = useState<SyncStatusRecord[]>([]);

  async function reloadProfiles() {
    const d = await fetch("/api/settings/profiles").then((r) => r.json());
    setProfiles(d.profiles ?? []);
    setActiveId(d.active_id ?? null);
  }

  useEffect(() => {
    reloadProfiles();
    fetch("/api/settings/notion-targets").then((r) => r.json()).then((d) => setTargets((d.targets ?? []).join("\n")));
    fetch("/api/system").then((r) => r.json()).then((d) => setSync(d.sync ?? []));
  }, []);

  async function saveProfile(input: Parameters<React.ComponentProps<typeof ProfileForm>["onSave"]>[0]) {
    if (input.id) {
      await fetch(`/api/settings/profiles/${input.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    } else {
      await fetch("/api/settings/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    }
    setEditing(null);
    setAdding(false);
    reloadProfiles();
  }

  async function setActive(id: string) {
    await fetch("/api/settings/profiles/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    reloadProfiles();
  }

  async function deleteProfile(id: string) {
    if (!confirm("Delete this profile? Its encrypted key will be gone.")) return;
    await fetch(`/api/settings/profiles/${id}`, { method: "DELETE" });
    reloadProfiles();
  }

  async function saveTargets() {
    setTargetsStatus(null);
    const list = targets.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const res = await fetch("/api/settings/notion-targets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targets: list }),
    });
    const d = await res.json();
    if (!res.ok) setTargetsStatus(`error: ${d.error}`);
    else {
      setTargetsStatus("saved");
      setTimeout(() => setTargetsStatus(null), 2000);
    }
  }

  return (
    <div className="h-screen overflow-y-auto">
      <div className="px-6 py-6">
        <div className="mono text-2xs text-text-dim uppercase tracking-wider mb-1">configuration</div>
        <h1 className="text-xl text-text-primary font-medium mb-6">Settings</h1>

        <div className="bg-raised border border-border-default rounded-md p-5 mb-4">
          <div className="flex items-center mb-4">
            <span className="mono text-2xs text-text-muted uppercase tracking-wider">provider profiles</span>
            <button
              onClick={() => { setAdding(true); setEditing(null); }}
              className="ml-auto mono text-2xs px-2.5 py-1 border border-border-default rounded-sm text-text-primary hover:bg-hover"
            >+ add profile</button>
          </div>
          <div className="flex flex-col gap-2">
            {profiles.length === 0 && !adding && (
              <div className="text-xs text-text-muted py-4 text-center">No profiles configured.</div>
            )}
            {profiles.map((p) => (
              editing?.id === p.id ? (
                <ProfileForm
                  key={p.id}
                  initial={{
                    id: p.id, name: p.name, type: p.type,
                    default_model: p.default_model, base_url: p.base_url,
                    max_context_tokens: p.max_context_tokens,
                  }}
                  onSave={saveProfile}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <ProfileCard
                  key={p.id}
                  profile={p}
                  active={p.id === activeId}
                  onSetActive={() => setActive(p.id)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => deleteProfile(p.id)}
                />
              )
            ))}
            {adding && (
              <ProfileForm
                onSave={saveProfile}
                onCancel={() => setAdding(false)}
              />
            )}
          </div>
        </div>

        <ClassifierSettings />

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-raised border border-border-default rounded-md p-5">
            <div className="mono text-2xs text-text-muted uppercase tracking-wider mb-3">notion sync targets</div>
            <div className="mono text-2xs text-text-subtle mb-2">page IDs, one per line</div>
            <textarea
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              rows={5}
              className="w-full bg-sunken border border-border-default rounded-sm p-2 mono text-2xs text-text-primary focus:border-accent focus:outline-none"
            />
            <div className="flex items-center gap-3 mt-2">
              <button onClick={saveTargets} className="mono text-2xs px-2.5 py-1 bg-accent text-raised rounded-sm font-medium">save</button>
              {targetsStatus && <span className="mono text-2xs text-text-subtle">{targetsStatus}</span>}
            </div>
          </div>

          <div className="bg-raised border border-border-default rounded-md p-5">
            <div className="mono text-2xs text-text-muted uppercase tracking-wider mb-3">actions</div>
            <div className="flex flex-col gap-2">
              <ActionButton label="run vault indexer" endpoint="/api/actions/reindex" />
              <ActionButton
                label="re-seed bins from folders"
                endpoint="/api/actions/seed-bins"
                confirm="Re-apply automatic bin assignments from folder layout? Manual assignments are preserved."
              />
              <ActionButton label="run notion sync" endpoint="/api/actions/sync-notion" />
            </div>
          </div>
        </div>

        <div className="bg-raised border border-border-default rounded-md p-5">
          <div className="mono text-2xs text-text-muted uppercase tracking-wider mb-3">sync health</div>
          <div className="mono text-2xs">
            {sync.map((s) => {
              const fresh = Date.now() - new Date(s.last_run_at).getTime() < 10 * 60_000;
              return (
                <div key={s.sync_name} className="flex justify-between py-1">
                  <span className="text-text-primary">{s.sync_name}</span>
                  <span className={fresh ? "text-accent" : "text-text-subtle"}>
                    ● {relTime(s.last_run_at)}
                  </span>
                </div>
              );
            })}
            {sync.length === 0 && <div className="text-text-muted">No sync runs yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
