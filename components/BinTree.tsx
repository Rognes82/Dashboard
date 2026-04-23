"use client";

import { useState } from "react";
import type { BinNode } from "@/lib/types";

interface Props {
  bins: BinNode[];
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
}

export function BinTree({ bins, selectedBinId, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <button
        onClick={() => onSelect(null)}
        className={`text-left px-2 py-1 rounded ${selectedBinId === null ? "bg-hover text-text-primary" : "text-text-muted hover:bg-hover/50"}`}
      >
        All notes
      </button>
      {bins.length === 0 ? (
        <div className="text-text-muted px-2 py-1 text-[10px]">
          No bins yet. Run Settings → Initial vault scan.
        </div>
      ) : (
        bins.map((bin) => (
          <BinNodeRow key={bin.id} node={bin} depth={0} selectedBinId={selectedBinId} onSelect={onSelect} />
        ))
      )}
    </div>
  );
}

function BinNodeRow({
  node,
  depth,
  selectedBinId,
  onSelect,
}: {
  node: BinNode;
  depth: number;
  selectedBinId: string | null;
  onSelect: (binId: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedBinId;
  return (
    <div>
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-text-muted hover:text-text-primary w-4 text-[10px] shrink-0"
            aria-label={expanded ? "collapse" : "expand"}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          onClick={() => onSelect(node.id)}
          style={{ paddingLeft: `${depth * 8}px` }}
          className={`flex-1 text-left px-2 py-1 rounded ${isSelected ? "bg-hover text-text-primary" : "text-text-secondary hover:bg-hover/50"}`}
        >
          {node.name}{" "}
          <span className="text-text-muted text-[10px]">({node.note_count})</span>
        </button>
      </div>
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <BinNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedBinId={selectedBinId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
