"use client";

import { useEffect, useState } from "react";
import { Modal, ModalFooter } from "./Modal";
import type { BinNode } from "@/lib/types";

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
  const excludedSet = new Set<string>();
  function walk(node: BinNode) {
    excludedSet.add(node.id);
    node.children?.forEach(walk);
  }
  function findBy(id: string, list: BinNode[]): BinNode | null {
    for (const b of list) {
      if (b.id === id) return b;
      const c = b.children ? findBy(id, b.children) : null;
      if (c) return c;
    }
    return null;
  }
  excludeIds.forEach((id) => {
    const node = findBy(id, bins);
    if (node) walk(node);
  });

  return (
    <Modal open={open} onClose={onClose} title={title} size="md">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter bins…"
        className="w-full px-3 py-2 bg-base border border-border-default rounded text-text-primary outline-none focus:border-accent"
      />
      <div className="mt-3 max-h-72 overflow-auto border border-border-default rounded p-2">
        {showTopLevelOption && (
          <button
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
            filter={filter}
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
  filter: string;
  depth?: number;
}

function PickableTree({ bins, selectedId, onSelect, excludedSet, alreadyInIds, disableAlreadyIn, filter, depth = 0 }: PickableTreeProps) {
  const q = filter.trim().toLowerCase();
  return (
    <ul>
      {bins.map((b) => {
        const matches = !q || b.name.toLowerCase().includes(q);
        const childrenRender = b.children && b.children.length > 0
          ? <PickableTree bins={b.children} selectedId={selectedId} onSelect={onSelect}
              excludedSet={excludedSet} alreadyInIds={alreadyInIds}
              disableAlreadyIn={disableAlreadyIn} filter={filter} depth={depth + 1} />
          : null;
        // Hide subtree if neither this node nor any descendant matches
        if (!matches && !childContainsMatch(b, q)) return null;

        const excluded = excludedSet.has(b.id);
        const alreadyIn = alreadyInIds.includes(b.id);
        const disabled = excluded || (alreadyIn && disableAlreadyIn);
        const isSelected = selectedId === b.id;
        return (
          <li key={b.id}>
            <button
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

function childContainsMatch(node: BinNode, q: string): boolean {
  if (!q) return true;
  if (node.name.toLowerCase().includes(q)) return true;
  return (node.children ?? []).some((c) => childContainsMatch(c, q));
}
