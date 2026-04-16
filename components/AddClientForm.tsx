"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AddClientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pipelineStage, setPipelineStage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pipeline_stage: pipelineStage || undefined }),
      });
      if (!res.ok) {
        let message = `failed to create (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error && typeof data.error === "string") message = data.error;
        } catch {
          // non-JSON response, keep default message
        }
        throw new Error(message);
      }
      setName("");
      setPipelineStage("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="text-2xs uppercase tracking-wider text-text-secondary block mb-1">
          Client Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Akoola"
          required
          className="w-full bg-base border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-green"
        />
      </div>
      <div>
        <label className="text-2xs uppercase tracking-wider text-text-secondary block mb-1">
          Pipeline Stage (optional)
        </label>
        <input
          type="text"
          value={pipelineStage}
          onChange={(e) => setPipelineStage(e.target.value)}
          placeholder="scripts delivered"
          className="w-full bg-base border border-border rounded px-3 py-2 text-xs text-text-primary outline-none focus:border-accent-green"
        />
      </div>
      {error && <div className="text-xs text-accent-red">{error}</div>}
      <button
        type="submit"
        disabled={submitting || !name}
        className="bg-accent-green/10 text-accent-green text-xs font-medium rounded py-2 disabled:opacity-50 hover:bg-accent-green/20 transition-colors"
      >
        {submitting ? "Adding..." : "Add Client"}
      </button>
    </form>
  );
}
