"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { BinNode, SyncStatusRecord } from "@/lib/types";
import { BinTree } from "./BinTree";
import { ChatIcon, BinsIcon, ReviewIcon, SettingsIcon, SearchIcon } from "./icons";

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
  const [bins, setBins] = useState<BinNode[]>([]);
  const [filter, setFilter] = useState("");
  const [sync, setSync] = useState<SyncStatusRecord[]>([]);

  useEffect(() => {
    fetch("/api/bins")
      .then((r) => r.json())
      .then((d) => setBins(d.bins ?? []));
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

      <div className="px-2 pt-2 pb-1">
        <label className="relative block">
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
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <BinTree
          bins={bins}
          selectedBinId={selectedBinId}
          onSelect={onSelectBin}
          filterQuery={filter}
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
