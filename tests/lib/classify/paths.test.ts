import { describe, it, expect } from "vitest";
import { slugifyPath, buildBinTree, parentOf, tail, normalizeLlmPath } from "../../../lib/classify/paths";

interface BinRow {
  id: string;
  name: string;
  parent_bin_id: string | null;
}

const sample: BinRow[] = [
  { id: "b1", name: "Business Planning", parent_bin_id: null },
  { id: "b2", name: "OKRs", parent_bin_id: "b1" },
  { id: "b3", name: "Travel", parent_bin_id: null },
  { id: "b4", name: "Japan 2024", parent_bin_id: "b3" },
  { id: "b5", name: "!!!", parent_bin_id: null },
];

describe("slugifyPath", () => {
  it("walks parents and slugifies each segment", () => {
    expect(slugifyPath(sample[1], sample)).toBe("business-planning/okrs");
    expect(slugifyPath(sample[3], sample)).toBe("travel/japan-2024");
  });

  it("returns empty string for bins whose name slugifies to ''", () => {
    expect(slugifyPath(sample[4], sample)).toBe("");
  });

  it("returns just the slug for top-level bins", () => {
    expect(slugifyPath(sample[0], sample)).toBe("business-planning");
  });
});

describe("buildBinTree", () => {
  it("builds Map<slugPath, binId>", () => {
    const tree = buildBinTree(sample);
    expect(tree.get("business-planning")).toBe("b1");
    expect(tree.get("business-planning/okrs")).toBe("b2");
    expect(tree.get("travel/japan-2024")).toBe("b4");
  });

  it("skips empty-slug bins", () => {
    const tree = buildBinTree(sample);
    expect(tree.has("")).toBe(false);
  });
});

describe("parentOf", () => {
  it("returns parent path or null for top-level", () => {
    expect(parentOf("a/b/c")).toBe("a/b");
    expect(parentOf("a/b")).toBe("a");
    expect(parentOf("a")).toBe(null);
  });
});

describe("tail", () => {
  it("returns last segment", () => {
    expect(tail("a/b/c")).toBe("c");
    expect(tail("a")).toBe("a");
  });
});

describe("normalizeLlmPath", () => {
  it("lowercases, trims, collapses slashes, slugifies segments", () => {
    expect(normalizeLlmPath("Business Planning/OKRs")).toBe("business-planning/okrs");
    expect(normalizeLlmPath("/business-planning/okrs/")).toBe("business-planning/okrs");
    expect(normalizeLlmPath("Travel & Leisure/Japan 2024")).toBe("travel-leisure/japan-2024");
    expect(normalizeLlmPath("Deep  Work")).toBe("deep-work");
  });

  it("filters empty segments", () => {
    expect(normalizeLlmPath("a//b")).toBe("a/b");
    expect(normalizeLlmPath("///")).toBe("");
  });

  it("returns empty string when fully unrecognizable", () => {
    expect(normalizeLlmPath("!!!")).toBe("");
    expect(normalizeLlmPath("")).toBe("");
  });
});
