"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, ModalFooter } from "./Modal";
import type { BinNode } from "@/lib/types";
import { findBinById, collectMatchingIds } from "@/lib/bins/tree";

interface BinPickerProps {
  open: boolean;
  onClose(): void;
  onPick(binId: string | null): void; // null only for "Top level (no parent)"
  title: string;
  /** Bins (and their descendants) the user cannot pick. */
  excludeIds?: string[];
  /** Bins to mark "(already here)" — disabled if `disableAlreadyIn` true */
  alreadyInIds?: string[];
  disableAlreadyIn?: boolean;
  /** Show the "Top level (no parent)" pseudo-row above the tree (only for "Move bin…"). */
  showTopLevelOption?: boolean;
}

export function BinPicker({
  open, onClose, onPick, title, excludeIds = [], alreadyInIds = [], disableAlreadyIn = false, showTopLevelOption = false,
}: BinPickerProps) {
  const [bins, setBins] = useState<BinNode[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setFilter("");
    fetch("/api/bins").then((r) => r.json()).then((d) => setBins(d.bins ?? [])).catch(() => setBins([]));
  }, [open]);

  // Compute the full set of excluded IDs including descendants of `excludeIds`
  const excludedSet = useMemo(() => {
    const out = new Set<string>();
    function walk(node: BinNode) {
      out.add(node.id);
      node.children?.forEach(walk);
    }
    excludeIds.forEach((id) => {
      const node = findBinById(bins, id);
      if (node) walk(node);
    });
    return out;
  }, [bins, excludeIds]);

  const visibleIds = useMemo(() => {
    const q = filter.trim();
    if (!q) return null;
    const out = new Set<string>();
    collectMatchingIds(bins, q, out);
    return out;
  }, [bins, filter]);

  // Flat list of selectable bin IDs (and null for top-level pseudo-row)
  // in render-display order. Used for arrow-key navigation.
  const selectableIds: Array<string | null> = useMemo(() => {
    const out: Array<string | null> = [];
    if (showTopLevelOption) out.push(null);
    function walk(nodes: BinNode[]) {
      for (const b of nodes) {
        if (visibleIds && !visibleIds.has(b.id)) continue;
        const excluded = excludedSet.has(b.id);
        const alreadyDisabled = alreadyInIds.includes(b.id) && disableAlreadyIn;
        if (!excluded && !alreadyDisabled) out.push(b.id);
        if (b.children?.length) walk(b.children);
      }
    }
    walk(bins);
    return out;
  }, [bins, visibleIds, excludedSet, alreadyInIds, disableAlreadyIn, showTopLevelOption]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (selectableIds.length === 0) return;
      e.preventDefault();
      const currentIdx = selectableIds.indexOf(selected);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      const len = selectableIds.length;
      const nextIdx = currentIdx === -1
        ? (delta === 1 ? 0 : len - 1)
        : (currentIdx + delta + len) % len;
      setSelected(selectableIds[nextIdx]);
    } else if (e.key === "Enter") {
      if (showTopLevelOption || selected !== null) {
        e.preventDefault();
        onPick(selected);
        onClose();
      }
    }
  }

  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // selected is `string | null` — null is the "Top level" pseudo-row marker.
    // The ?? "__top__" handles the null case; no other guard needed.
    const target = selected ?? "__top__";
    const el = bodyRef.current?.querySelector(`[data-bin-id="${target}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <div ref={bodyRef} onKeyDown={handleKeyDown} tabIndex={-1} className="outline-none">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter bins…"
          className="w-full px-3 py-2 bg-base border border-border-default rounded text-text-primary outline-none focus:border-accent"
        />
        <div className="mt-3 max-h-72 overflow-auto border border-border-default rounded p-2">
          {showTopLevelOption && (
            <button
              data-bin-id="__top__"
              onClick={() => setSelected(null)}
              className={[
                "w-full text-left px-2 py-1 rounded text-xs font-mono uppercase tracking-wide",
                selected === null ? "bg-accent/20 text-accent ring-1 ring-accent" : "text-text-secondary hover:bg-base",
              ].join(" ")}
            >
              ↑ Top level (no parent)
            </button>
          )}
          {bins.length === 0 ? (
            <div className="text-xs text-text-tertiary py-2">No bins yet — create one first.</div>
          ) : (
            <PickableTree
              bins={bins}
              selectedId={selected}
              onSelect={(id) => setSelected(id)}
              excludedSet={excludedSet}
              alreadyInIds={alreadyInIds}
              disableAlreadyIn={disableAlreadyIn}
              visibleIds={visibleIds}
            />
          )}
        </div>
        <ModalFooter>
          <button onClick={onClose} className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs text-text-secondary hover:text-text-primary">
            Cancel
          </button>
          <button
            disabled={!showTopLevelOption && !selected}
            onClick={() => { onPick(selected); onClose(); }}
            className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs bg-accent text-base rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm
          </button>
        </ModalFooter>
      </div>
    </Modal>
  );
}

interface PickableTreeProps {
  bins: BinNode[];
  selectedId: string | null;
  onSelect(id: string): void;
  excludedSet: Set<string>;
  alreadyInIds: string[];
  disableAlreadyIn: boolean;
  visibleIds: Set<string> | null;
  depth?: number;
}

function PickableTree({ bins, selectedId, onSelect, excludedSet, alreadyInIds, disableAlreadyIn, visibleIds, depth = 0 }: PickableTreeProps) {
  return (
    <ul>
      {bins.map((b) => {
        if (visibleIds && !visibleIds.has(b.id)) return null;
        const childrenRender = b.children && b.children.length > 0
          ? <PickableTree bins={b.children} selectedId={selectedId} onSelect={onSelect}
              excludedSet={excludedSet} alreadyInIds={alreadyInIds}
              disableAlreadyIn={disableAlreadyIn} visibleIds={visibleIds} depth={depth + 1} />
          : null;

        const excluded = excludedSet.has(b.id);
        const alreadyIn = alreadyInIds.includes(b.id);
        const disabled = excluded || (alreadyIn && disableAlreadyIn);
        const isSelected = selectedId === b.id;
        return (
          <li key={b.id}>
            <button
              data-bin-id={b.id}
              disabled={disabled}
              onClick={() => onSelect(b.id)}
              style={{ paddingLeft: depth * 12 + 8 }}
              className={[
                "w-full text-left py-1 pr-2 text-xs font-mono uppercase tracking-wide rounded",
                disabled
                  ? "text-text-tertiary cursor-not-allowed"
                  : isSelected
                  ? "bg-accent/20 text-accent ring-1 ring-accent"
                  : "text-text-primary hover:bg-base",
              ].join(" ")}
              title={excluded ? "Can't move into itself or a child" : undefined}
            >
              {b.name}
              {alreadyIn && <span className="ml-2 text-text-tertiary">(already here)</span>}
            </button>
            {childrenRender}
          </li>
        );
      })}
    </ul>
  );
}
