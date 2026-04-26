import type { BinNode } from "@/lib/types";

/**
 * Compute a new sort_order value for a bin being dropped into a sibling list.
 * - Between prev and before: midpoint average
 * - At the start (no prev): before.sort_order - 1000
 * - At the end (before=null): last.sort_order + 1000
 * - Empty list: 0
 *
 * The schema (sort_order REAL) supports fractional values; precision-collapse
 * is handled server-side by updateBinSortOrder's renumber-on-gap-collapse.
 */
export function computeNewSortOrder(
  prev: BinNode | null,
  before: BinNode | null,
  last: BinNode | null
): number {
  if (prev && before) return ((prev.sort_order ?? 0) + (before.sort_order ?? 0)) / 2;
  if (!prev && before) return (before.sort_order ?? 0) - 1000;
  if (last) return (last.sort_order ?? 0) + 1000;
  return 0;
}
