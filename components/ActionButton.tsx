"use client";

import { useState } from "react";

interface Props {
  label: string;
  endpoint: string;
  confirm?: string;
}

export function ActionButton({ label, endpoint, confirm }: Props) {
  const [status, setStatus] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setStatus("running");
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setError(data.error ?? "Action failed");
        setStatus("error");
        return;
      }
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={run}
        disabled={status === "running"}
        className="bg-base border border-border rounded px-2.5 py-1.5 text-xs text-text-primary hover:bg-hover disabled:opacity-50"
      >
        {status === "running" ? "Running…" : status === "ok" ? "Done ✓" : label}
      </button>
      {error && <span className="text-[10px] text-red-400 truncate max-w-[200px]" title={error}>{error}</span>}
    </div>
  );
}
