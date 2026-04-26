"use client";

import { Fragment, useMemo } from "react";
import type { BinNode } from "@/lib/types";
import { collectMatchingIds } from "@/lib/bins/tree";
import { BinRow } from "./BinRow";
import { DropStrip } from "./DropStrip";

export interface BinTreeProps {
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
        <>
          {bins.map((bin, i) => (
            <Fragment key={bin.id}>
              <DropStrip
                parentId={null}
                beforeNode={bin}
                prevNode={bins[i - 1] ?? null}
                lastNode={bins[bins.length - 1] ?? null}
                onRefresh={onRefresh}
              />
              <BinRow
                node={bin}
                parentBinId={null}
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
            </Fragment>
          ))}
          <DropStrip
            parentId={null}
            beforeNode={null}
            prevNode={bins[bins.length - 1] ?? null}
            lastNode={bins[bins.length - 1] ?? null}
            onRefresh={onRefresh}
          />
        </>
      )}
    </ul>
  );
}
