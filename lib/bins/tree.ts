import type { BinNode } from "../types";

/**
 * Recursively find a bin in a tree by ID. Returns null if not found.
 */
export function findBinById(bins: BinNode[], id: string): BinNode | null {
  for (const bin of bins) {
    if (bin.id === id) return bin;
    const found = findBinById(bin.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Walk the tree adding any bin to `out` whose name (or any descendant's name)
 * contains `q` (case-insensitive). Returns true if any match was found at this
 * level. Used by BinTree (visibility filter) and BinPicker (same job).
 */
export function collectMatchingIds(bins: BinNode[], q: string, out: Set<string>): boolean {
  const qLower = q.toLowerCase();
  let anyMatch = false;
  for (const bin of bins) {
    const selfMatch = bin.name.toLowerCase().includes(qLower);
    const childrenMatch = collectMatchingIds(bin.children, qLower, out);
    if (selfMatch || childrenMatch) {
      out.add(bin.id);
      anyMatch = true;
    }
  }
  return anyMatch;
}
