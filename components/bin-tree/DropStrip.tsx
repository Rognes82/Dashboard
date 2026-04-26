"use client";

import type { BinNode } from "@/lib/types";
import { useDrop } from "@/lib/dnd";
import { useToast } from "../chat/ToastProvider";
import { computeNewSortOrder } from "./sort-order";

interface DropStripProps {
  parentId: string | null;
  beforeNode: BinNode | null; // null = drop at end
  prevNode: BinNode | null;
  lastNode: BinNode | null;
  onRefresh?: () => void;
}

export function DropStrip({ parentId, beforeNode, prevNode, lastNode, onRefresh }: DropStripProps) {
  const { show } = useToast();
  const { hover, dropProps } = useDrop({
    accept: (payload) => payload.kind === "bin",
    onDrop: async (payload) => {
      const newSortOrder = computeNewSortOrder(prevNode, beforeNode, lastNode);
      try {
        const res = await fetch(`/api/bins/${payload.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sort_order: newSortOrder, parent_bin_id: parentId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          show(err.error ?? `Reorder failed (${res.status})`, "error");
        } else {
          onRefresh?.();
        }
      } catch (e) {
        show(e instanceof Error ? e.message : "Reorder failed", "error");
      }
    },
  });
  // Use <li role="presentation"> rather than <div> so we stay HTML-valid
  // when rendered inside the parent <ul>. aria-hidden because it's a UI-only
  // affordance, not navigable content.
  return (
    <li
      role="presentation"
      aria-hidden="true"
      {...dropProps}
      className={`h-1 -my-0.5 list-none ${hover === "valid" ? "bg-accent" : "bg-transparent"}`}
    />
  );
}
