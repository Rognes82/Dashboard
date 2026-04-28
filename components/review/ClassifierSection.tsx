"use client";
import { useEffect, useState, useCallback } from "react";
import { PendingProposalsCard, type ProposalForCard } from "./PendingProposalsCard";
import { RecentlyAutoClassifiedCard, type RecentRow } from "./RecentlyAutoClassifiedCard";

interface LastRun {
  started_at: number;
  finished_at: number | null;
  notes_seen: number;
  notes_auto_assigned: number;
  notes_auto_created: number;
  notes_pending: number;
  notes_errored: number;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function ClassifierSection() {
  const [proposals, setProposals] = useState<ProposalForCard[]>([]);
  const [recent, setRecent] = useState<RecentRow[]>([]);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [pRes, rRes, lRes] = await Promise.all([
      fetch("/api/classify/proposals"),
      fetch("/api/classify/recent"),
      fetch("/api/classify/last-run"),
    ]);
    const pData = await pRes.json();
    const rData = await rRes.json();
    const lData = await lRes.json();
    setProposals(pData.proposals);
    setRecent(rData.rows);
    setLastRun(lData.run);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runNow(): Promise<void> {
    if (running) return;
    setRunning(true);
    setToast(null);
    try {
      const res = await fetch("/api/classify/run", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error ?? `HTTP ${res.status}`);
      } else {
        setToast(
          `Classified ${data.notes_seen} — ${data.notes_auto_assigned} assigned, ${data.notes_auto_created} created, ${data.notes_pending} pending, ${data.notes_errored} errored`
        );
      }
      await refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 font-mono text-sm">
        <button
          disabled={running}
          onClick={runNow}
          className="px-3 py-1 border border-cyan-500/50 text-cyan-300 rounded hover:bg-cyan-500/10 disabled:opacity-50"
        >
          {running ? "Running…" : "Run classifier now"}
        </button>
        {lastRun && (
          <span className="text-white/50 text-xs">
            Last run: {relativeTime(lastRun.started_at)} — {lastRun.notes_seen} seen / {lastRun.notes_auto_assigned} assigned / {lastRun.notes_auto_created} created / {lastRun.notes_pending} pending / {lastRun.notes_errored} errored
          </span>
        )}
        {toast && <span className="text-white/70 text-xs ml-auto">{toast}</span>}
      </div>
      <PendingProposalsCard proposals={proposals} onChanged={refresh} />
      <RecentlyAutoClassifiedCard rows={recent} onChanged={refresh} />
    </div>
  );
}
