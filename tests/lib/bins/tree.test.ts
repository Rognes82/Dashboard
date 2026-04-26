import { describe, it, expect } from "vitest";
import { findBinById, collectMatchingIds } from "../../../lib/bins/tree";
import type { BinNode } from "../../../lib/types";

function makeBin(id: string, name: string, children: BinNode[] = []): BinNode {
  return {
    id, name,
    parent_bin_id: null,
    source_seed: null,
    created_at: "2026-04-26T00:00:00Z",
    sort_order: 0,
    children,
    note_count: 0,
  };
}

describe("findBinById", () => {
  it("finds a top-level bin", () => {
    const bins = [makeBin("a", "A"), makeBin("b", "B")];
    expect(findBinById(bins, "b")?.id).toBe("b");
  });
  it("finds a deeply nested bin", () => {
    const bins = [makeBin("a", "A", [makeBin("b", "B", [makeBin("c", "C")])])];
    expect(findBinById(bins, "c")?.id).toBe("c");
  });
  it("returns null when bin is missing", () => {
    expect(findBinById([makeBin("a", "A")], "z")).toBeNull();
  });
  it("returns null on empty list", () => {
    expect(findBinById([], "anything")).toBeNull();
  });
  it("finds a single bin at root", () => {
    expect(findBinById([makeBin("a", "A")], "a")?.id).toBe("a");
  });
});

describe("collectMatchingIds", () => {
  it("returns empty set on no match", () => {
    const out = new Set<string>();
    collectMatchingIds([makeBin("a", "Alpha")], "zzz", out);
    expect([...out]).toEqual([]);
  });
  it("includes bin id when name matches", () => {
    const out = new Set<string>();
    collectMatchingIds([makeBin("a", "Alpha")], "alp", out);
    expect([...out]).toEqual(["a"]);
  });
  it("includes ancestor when descendant matches", () => {
    const root = makeBin("root", "Root", [makeBin("child", "ChildBin", [makeBin("leaf", "LeafTarget")])]);
    const out = new Set<string>();
    collectMatchingIds([root], "leaf", out);
    expect(out.has("root")).toBe(true);
    expect(out.has("child")).toBe(true);
    expect(out.has("leaf")).toBe(true);
  });
  it("returns true when any match found, false otherwise", () => {
    const out = new Set<string>();
    expect(collectMatchingIds([makeBin("a", "A")], "a", out)).toBe(true);
    const out2 = new Set<string>();
    expect(collectMatchingIds([makeBin("a", "A")], "z", out2)).toBe(false);
  });
});
