"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Client } from "@/lib/types";

interface Props {
  projectId: string;
  currentClientId: string | null;
  clients: Client[];
}

export function ProjectClientSelect({ projectId, currentClientId, clients }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = currentClientId ?? "";
  const [value, setValue] = useState(initial);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    const previous = value;
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: next || null }),
      });
      if (!res.ok) {
        let message = `save failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error && typeof data.error === "string") message = data.error;
        } catch {
          // non-JSON response
        }
        throw new Error(message);
      }
      router.refresh();
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <select
        value={value}
        onChange={handleChange}
        disabled={saving}
        className="bg-base border border-border rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-green disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {error && <span className="text-[10px] text-accent-red">{error}</span>}
    </div>
  );
}
