"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { BinNode, SyncStatusRecord } from "@/lib/types";
import { findBinById } from "@/lib/bins/tree";
import { BinTree } from "./BinTree";
import { CreateBinModal } from "./CreateBinModal";
import { BinPicker } from "./BinPicker";
import { DeleteBinModal } from "./DeleteBinModal";
import { MergeBinModal } from "./MergeBinModal";
import { useToast } from "./chat/ToastProvider";
import { ChatIcon, BinsIcon, ReviewIcon, SettingsIcon, SearchIcon, PlusIcon } from "./icons";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof ChatIcon;
}

const NAV: NavItem[] = [
  { href: "/", label: "Chat", Icon: ChatIcon },
  { href: "/bins", label: "Bins", Icon: BinsIcon },
  { href: "/review", label: "Review", Icon: ReviewIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
];

export function Sidebar({
  selectedBinId,
  onSelectBin,
}: {
  selectedBinId: string | null;
  onSelectBin: (id: string | null) => void;
}) {
  const pathname = usePathname();
  const toast = useToast();
  const [bins, setBins] = useState<BinNode[]>([]);
  const [filter, setFilter] = useState("");
  const [sync, setSync] = useState<SyncStatusRecord[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createParent, setCreateParent] = useState<{ id: string | null; name?: string }>({ id: null });
  const [refreshKey, setRefreshKey] = useState(0);
  const [moveBin, setMoveBin] = useState<BinNode | null>(null);
  type MergeFlow =
    | { phase: "idle" }
    | { phase: "picking"; source: BinNode }
    | { phase: "confirming"; source: BinNode; target: { id: string; name: string } };
  const [merge, setMerge] = useState<MergeFlow>({ phase: "idle" });
  const [deleteBin, setDeleteBin] = useState<BinNode | null>(null);

  useEffect(() => {
    fetch("/api/bins")
      .then((r) => r.json())
      .then((d) => setBins(d.bins ?? []));
  }, [refreshKey]);

  useEffect(() => {
    fetch("/api/system")
      .then((r) => r.json())
      .then((d) => setSync(d.sync ?? []));
  }, []);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname?.startsWith(href + "/");
  };

  const freshestSync = sync.reduce<SyncStatusRecord | null>((best, s) => {
    if (s.status !== "ok") return best;
    if (!best) return s;
    return s.last_run_at > best.last_run_at ? s : best;
  }, null);

  const freshDot =
    freshestSync &&
    Date.now() - new Date(freshestSync.last_run_at).getTime() < 10 * 60_000;

  return (
    <aside className="fixed top-0 left-0 h-screen w-[220px] bg-raised border-r border-border-default flex flex-col z-10">
      <div className="flex items-center gap-3.5 px-3 py-2.5 border-b border-border-default">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-label={item.label}
            className="p-1 rounded text-text-muted hover:text-text-primary"
          >
            <item.Icon size={14} active={isActive(item.href)} />
          </Link>
        ))}
      </div>

      <div className="px-2 pt-2 pb-1 flex items-center gap-1.5">
        <label className="relative block flex-1">
          <span className="sr-only">search bins</span>
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle">
            <SearchIcon size={10} />
          </span>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="search bins"
            className="w-full bg-hover border border-border-default rounded-sm pl-6 pr-2 py-1 text-2xs text-text-primary placeholder:text-text-subtle mono focus:border-accent focus:outline-none"
          />
        </label>
        <button
          onClick={() => {
            setCreateParent({ id: null });
            setCreateOpen(true);
          }}
          title="New bin"
          aria-label="New bin"
          className="p-1 rounded text-text-muted hover:text-text-primary"
        >
          <PlusIcon size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <BinTree
          bins={bins}
          selectedBinId={selectedBinId}
          onSelect={onSelectBin}
          filterQuery={filter}
          onRefresh={() => {
            setRefreshKey((k) => k + 1);
            // Notify other surfaces (e.g., page-level NoteList) that a bin
            // mutation happened — drag-to-sidebar moves a note out of the
            // current view, but the page wouldn't know to refetch otherwise.
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("dashboard-bins-mutated"));
            }
          }}
          onRequestNewChild={(parent) => {
            setCreateParent({ id: parent.id, name: parent.name });
            setCreateOpen(true);
          }}
          onRequestMoveBin={(bin) => setMoveBin(bin)}
          onRequestMerge={(bin) => setMerge({ phase: "picking", source: bin })}
          onRequestDelete={(bin) => setDeleteBin(bin)}
        />
      </div>

      <div className="px-3 py-2.5 border-t border-border-default flex items-center gap-2">
        <span
          className={`w-1.5 h-1.5 rounded-full ${freshDot ? "bg-accent" : "bg-text-dim"}`}
          style={freshDot ? { boxShadow: "0 0 6px #7dd3fc" } : undefined}
        />
        <span className="mono text-2xs text-text-dim">
          {freshestSync
            ? `synced ${relTime(freshestSync.last_run_at)}`
            : "no sync yet"}
        </span>
      </div>

      <CreateBinModal
        open={createOpen}
        parentBinId={createParent.id}
        parentBinName={createParent.name ?? null}
        onClose={() => setCreateOpen(false)}
        onCreated={(newId) => {
          setFilter("");
          setRefreshKey((k) => k + 1);
          onSelectBin(newId);
        }}
      />

      {moveBin && (
        <BinPicker
          open={!!moveBin}
          onClose={() => setMoveBin(null)}
          title={`Move "${moveBin.name}" to…`}
          excludeIds={[moveBin.id]}
          showTopLevelOption
          onPick={async (targetId) => {
            try {
              const res = await fetch(`/api/bins/${moveBin.id}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ parent_bin_id: targetId }),
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error ?? `Move failed (${res.status})`);
              }
              toast.show(`Moved '${moveBin.name}'`, "info");
              setRefreshKey((k) => k + 1);
            } catch (e) {
              toast.show(e instanceof Error ? e.message : "Move failed", "error");
            }
          }}
        />
      )}

      {merge.phase === "picking" && (
        <BinPicker
          open
          onClose={() => setMerge({ phase: "idle" })}
          title={`Merge "${merge.source.name}" into…`}
          excludeIds={[merge.source.id]}
          onPick={(targetId) => {
            if (!targetId) return;
            // TS narrows merge.phase === "picking" inside this branch — capture for clarity.
            const source = merge.source;
            const target = findBinById(bins, targetId);
            setMerge({
              phase: "confirming",
              source,
              target: { id: targetId, name: target?.name ?? "?" },
            });
          }}
        />
      )}

      {merge.phase === "confirming" && (
        <MergeBinModal
          open
          sourceId={merge.source.id}
          sourceName={merge.source.name}
          targetId={merge.target.id}
          targetName={merge.target.name}
          onClose={() => setMerge({ phase: "idle" })}
          onMerged={(targetId) => {
            onSelectBin(targetId);
            setRefreshKey((k) => k + 1);
            setMerge({ phase: "idle" });
          }}
        />
      )}

      <DeleteBinModal
        open={!!deleteBin}
        binId={deleteBin?.id ?? null}
        binName={deleteBin?.name ?? ""}
        onClose={() => setDeleteBin(null)}
        onDeleted={() => {
          if (deleteBin && selectedBinId === deleteBin.id) onSelectBin(null);
          setRefreshKey((k) => k + 1);
        }}
      />
    </aside>
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

