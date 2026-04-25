"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BinNode } from "@/lib/types";
import { ChevronDownIcon, ChevronIcon } from "./icons";
import { useContextMenu } from "./ContextMenu";

interface BinTreeProps {
  bins: BinNode[];
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
  filterQuery?: string;
  onRefresh?: () => void;
  onRequestNewChild?: (parent: BinNode) => void;
  onRequestMoveBin?: (bin: BinNode) => void;
  onRequestMerge?: (bin: BinNode) => void;
  onRequestDelete?: (bin: BinNode) => void;
}

function collectMatchingIds(bins: BinNode[], q: string, out: Set<string>): boolean {
  const qLower = q.toLowerCase();
  let anyMatch = false;
  for (const bin of bins) {
    const selfMatch = bin.name.toLowerCase().includes(qLower);
    const childrenMatch = collectMatchingIds(bin.children, q, out);
    if (selfMatch || childrenMatch) {
      out.add(bin.id);
      anyMatch = true;
    }
  }
  return anyMatch;
}

export function BinTree({
  bins,
  selectedBinId,
  onSelect,
  filterQuery,
  onRefresh,
  onRequestNewChild,
  onRequestMoveBin,
  onRequestMerge,
  onRequestDelete,
}: BinTreeProps) {
  const visibleIds = useMemo(() => {
    if (!filterQuery || filterQuery.trim().length === 0) return null;
    const ids = new Set<string>();
    collectMatchingIds(bins, filterQuery.trim(), ids);
    return ids;
  }, [bins, filterQuery]);

  return (
    <ul role="tree" className="flex flex-col gap-0.5 text-xs mono">
      {bins.length === 0 ? (
        <li className="text-text-muted px-2 py-1 text-2xs">No bins yet.</li>
      ) : (
        bins.map((bin) => (
          <BinRow
            key={bin.id}
            node={bin}
            depth={0}
            selectedBinId={selectedBinId}
            onSelect={onSelect}
            visibleIds={visibleIds}
            forceExpand={!!filterQuery}
            onRefresh={onRefresh}
            onRequestNewChild={onRequestNewChild}
            onRequestMoveBin={onRequestMoveBin}
            onRequestMerge={onRequestMerge}
            onRequestDelete={onRequestDelete}
          />
        ))
      )}
    </ul>
  );
}

interface BinRowProps {
  node: BinNode;
  depth: number;
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
  visibleIds: Set<string> | null;
  forceExpand: boolean;
  onRefresh?: () => void;
  onRequestNewChild?: (parent: BinNode) => void;
  onRequestMoveBin?: (bin: BinNode) => void;
  onRequestMerge?: (bin: BinNode) => void;
  onRequestDelete?: (bin: BinNode) => void;
}

function BinRow({
  node,
  depth,
  selectedBinId,
  onSelect,
  visibleIds,
  forceExpand,
  onRefresh,
  onRequestNewChild,
  onRequestMoveBin,
  onRequestMerge,
  onRequestDelete,
}: BinRowProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(node.name);
  const [editError, setEditError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menu = useContextMenu();

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const isSelected = node.id === selectedBinId;
  const hasChildren = node.children.length > 0;
  if (visibleIds && !visibleIds.has(node.id)) return null;
  const open = forceExpand || expanded;

  async function commitRename() {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed.length > 120) {
      setEditError(!trimmed ? "Name required" : "Too long");
      return;
    }
    if (trimmed === node.name) {
      setEditing(false);
      return;
    }
    try {
      const res = await fetch(`/api/bins/${node.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`Rename failed (${res.status})`);
      setEditing(false);
      setEditError(null);
      onRefresh?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    const items: Array<{ label: string; action: () => void; danger?: boolean }> = [
      { label: "New child bin", action: () => onRequestNewChild?.(node) },
      {
        label: "Rename",
        action: () => {
          setEditValue(node.name);
          setEditing(true);
          setEditError(null);
        },
      },
      { label: "Move bin…", action: () => onRequestMoveBin?.(node) },
      { label: "Merge into…", action: () => onRequestMerge?.(node) },
    ];
    if (!node.source_seed) {
      items.push({ label: "Delete", action: () => onRequestDelete?.(node), danger: true });
    }
    menu.open(e, items);
  }

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={isSelected}>
      <div className="flex items-center gap-1" onContextMenu={handleContextMenu}>
        {hasChildren ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-text-muted hover:text-text-primary w-4 shrink-0"
            aria-label={open ? "collapse" : "expand"}
          >
            {open ? <ChevronDownIcon size={10} /> : <ChevronIcon size={10} />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {editing ? (
          <div
            className="flex-1 flex items-center gap-2 px-2 py-1"
            style={{ paddingLeft: `${depth * 10 + 8}px` }}
          >
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setEditing(false);
                  setEditError(null);
                } else if (e.key === "Enter") {
                  commitRename();
                }
              }}
              onBlur={commitRename}
              className="flex-1 min-w-0 bg-base border border-border-default rounded px-1 text-xs mono text-text-primary outline-none focus:border-accent"
            />
            {editError && <div className="text-2xs text-red-400 shrink-0">{editError}</div>}
          </div>
        ) : (
          <button
            onClick={() => onSelect(isSelected ? null : node.id)}
            style={{ paddingLeft: `${depth * 10}px` }}
            className={`flex-1 text-left px-2 py-1 rounded-sm ${
              isSelected
                ? "bg-accent-tint text-text-primary border-l-2 border-accent"
                : "text-text-tertiary hover:bg-hover hover:text-text-secondary"
            }`}
          >
            {node.name}{" "}
            <span className="text-text-subtle">· {node.note_count}</span>
          </button>
        )}
      </div>
      {open && hasChildren && (
        <ul className="pl-0">
          {node.children.map((child) => (
            <BinRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedBinId={selectedBinId}
              onSelect={onSelect}
              visibleIds={visibleIds}
              forceExpand={forceExpand}
              onRefresh={onRefresh}
              onRequestNewChild={onRequestNewChild}
              onRequestMoveBin={onRequestMoveBin}
              onRequestMerge={onRequestMerge}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
