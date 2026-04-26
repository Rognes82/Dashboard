import { describe, it, expect } from "vitest";
import { computeNewSortOrder } from "../../../components/bin-tree/sort-order";
import type { BinNode } from "../../../lib/types";

function makeBin(id: string, sort_order: number): BinNode {
  return {
    id, name: id,
    parent_bin_id: null,
    source_seed: null,
    created_at: "2026-04-26T00:00:00Z",
    sort_order,
    children: [],
    note_count: 0,
  };
}

describe("computeNewSortOrder", () => {
  it("returns midpoint when between two siblings", () => {
    const prev = makeBin("a", 1000);
    const before = makeBin("b", 2000);
    expect(computeNewSortOrder(prev, before, before)).toBe(1500);
  });

  it("returns before-1000 when at the start (no prev)", () => {
    const before = makeBin("a", 5000);
    expect(computeNewSortOrder(null, before, before)).toBe(4000);
  });

  it("returns last+1000 when at the end (before is null)", () => {
    const last = makeBin("z", 3000);
    expect(computeNewSortOrder(last, null, last)).toBe(4000);
  });

  it("returns 0 for an empty list (no prev, no before, no last)", () => {
    expect(computeNewSortOrder(null, null, null)).toBe(0);
  });
});
