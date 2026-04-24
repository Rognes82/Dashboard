"use client";

import { useMemo, useState } from "react";
import type { BinNode } from "@/lib/types";
import { ChevronDownIcon, ChevronIcon } from "./icons";

interface Props {
  bins: BinNode[];
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
  filterQuery?: string;
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

export function BinTree({ bins, selectedBinId, onSelect, filterQuery }: Props) {
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
          />
        ))
      )}
    </ul>
  );
}

function BinRow({
  node,
  depth,
  selectedBinId,
  onSelect,
  visibleIds,
  forceExpand,
}: {
  node: BinNode;
  depth: number;
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
  visibleIds: Set<string> | null;
  forceExpand: boolean;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected = node.id === selectedBinId;
  const hasChildren = node.children.length > 0;
  if (visibleIds && !visibleIds.has(node.id)) return null;
  const open = forceExpand || expanded;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={isSelected}>
      <div className="flex items-center gap-1">
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}
