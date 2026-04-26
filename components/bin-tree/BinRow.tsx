"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { BinNode } from "@/lib/types";
import { ChevronDownIcon, ChevronIcon } from "../icons";
import { useContextMenu } from "../ContextMenu";
import { useToast } from "../chat/ToastProvider";
import { useDrag, useDrop, useIsCommandHeld } from "@/lib/dnd";
import { DropStrip } from "./DropStrip";

export interface BinRowProps {
  node: BinNode;
  parentBinId: string | null;
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

export function BinRow({
  node,
  parentBinId,
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
  const { show } = useToast();

  // Drag-and-drop wiring (T23)
  const dragProps = useDrag({ kind: "bin", id: node.id });
  // Captured for ⌘-modifier disambiguation in the note-drop handler (T24).
  const isCommandHeldRef = useIsCommandHeld();

  const { hover, dropProps } = useDrop({
    accept: (payload) => {
      if (payload.kind === "bin") return payload.id !== node.id;
      if (payload.kind === "note") return true;
      return false;
    },
    onDrop: async (payload) => {
      if (payload.kind === "bin") {
        // Re-parent: PATCH parent_bin_id
        try {
          const res = await fetch(`/api/bins/${payload.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ parent_bin_id: node.id }),
          });
          if (res.ok) {
            onRefresh?.();
          } else {
            const err = await res.json().catch(() => ({}));
            show(err.error ?? `Re-parent failed (${res.status})`, "error");
          }
        } catch (e) {
          show(e instanceof Error ? e.message : "Re-parent failed", "error");
        }
      } else if (payload.kind === "note") {
        const isCmd = isCommandHeldRef.current;
        const sourceUnambiguous = !!payload.contextBinId;
        if (isCmd && sourceUnambiguous) {
          // Move
          try {
            const res = await fetch(`/api/notes/${payload.id}/move`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ from_bin_id: payload.contextBinId, to_bin_id: node.id }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              show(err.error ?? `Move failed (${res.status})`, "error");
            } else {
              show(`Moved to '${node.name}'`, "info");
              onRefresh?.();
            }
          } catch (e) {
            show(e instanceof Error ? e.message : "Move failed", "error");
          }
        } else {
          if (isCmd && !sourceUnambiguous) {
            show("Hold ⌘ to move only when a single source bin is clear", "warn");
          }
          // Add (default + ambiguous-source fallback)
          try {
            const res = await fetch(`/api/bins/${node.id}/assign`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ note_id: payload.id }),
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              show(err.error ?? `Add failed (${res.status})`, "error");
            } else {
              show(`Added to '${node.name}'`, "info");
              onRefresh?.();
            }
          } catch (e) {
            show(e instanceof Error ? e.message : "Add failed", "error");
          }
        }
      }
    },
  });

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

  const ringClass =
    hover === "valid"
      ? "ring-2 ring-accent"
      : hover === "invalid"
      ? "ring-2 ring-red-500 ring-dashed"
      : "";

  // Suppress unused-var warning for parentBinId — it's part of the API for
  // future use (e.g., sibling-aware drop targets) and clarifies the tree shape.
  void parentBinId;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={isSelected}>
      <div
        className={`flex items-center gap-1 rounded-sm ${ringClass}`}
        onContextMenu={handleContextMenu}
        {...dragProps}
        {...dropProps}
      >
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
          {node.children.map((child, i) => (
            <Fragment key={child.id}>
              <DropStrip
                parentId={node.id}
                beforeNode={child}
                prevNode={node.children[i - 1] ?? null}
                lastNode={node.children[node.children.length - 1] ?? null}
                onRefresh={onRefresh}
              />
              <BinRow
                node={child}
                parentBinId={node.id}
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
            </Fragment>
          ))}
          <DropStrip
            parentId={node.id}
            beforeNode={null}
            prevNode={node.children[node.children.length - 1] ?? null}
            lastNode={node.children[node.children.length - 1] ?? null}
            onRefresh={onRefresh}
          />
        </ul>
      )}
    </li>
  );
}
