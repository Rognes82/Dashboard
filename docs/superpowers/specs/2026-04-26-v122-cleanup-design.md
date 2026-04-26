# v1.2.2 Cleanup Design Spec

**Date:** 2026-04-26
**Status:** Draft, awaiting Kimi audit
**Builds on:** `docs/superpowers/specs/2026-04-25-manual-bin-management-design.md` (v1.2.1)

---

## 1. Motivation

v1.2.1 shipped manual bin management end-to-end — every API, every UI flow, every modal. Code review during execution surfaced a small set of loose ends that don't block users today but compound at v1.3 (auto-classify) time:

- `noteBins` props are wired through NoteList but never populated by the pages — the multi-bin badge `·N` and the Recent-view "Move to bin" context-menu item are dead code.
- `findBinInTree` (Sidebar) and `findBy` (BinPicker) are semantically identical functions in two files (argument order differs: `findBinInTree(bins, id)` vs `findBy(id, list)`). v1.3 will add a third caller (the classifier review modal) and we'd be duplicating again.
- Sidebar's merge flow uses 4 separate state vars that have to be cleared together; impossible states (target without source) are representable.
- `BinTree.tsx` is 433 lines covering 5 distinct concerns — fine today, painful when v1.3 needs to add classifier-proposed-bin badges to BinRow.
- `sort_order` averaging on drag-reorder works at 50-reorder scale but has no escape hatch for precision collapse.

v1.2.2 closes these gaps **before** v1.3 starts adding consumers that would amplify them.

The cleanup also includes targeted polish from the v1.2.1 review queue:
- Typed error class for the one server-side error message we currently regex-match in the API route.
- Keyboard navigation in the BinPicker (the most-used modal in daily flow).
- Move/Remove toast wording that includes destination/source bin names.
- Extract the filter-tree walker so BinTree and BinPicker share one implementation (Kimi flagged the divergence risk).

**v1.2.2 is intentionally a cleanup release.** No new user-facing features beyond the unblocked badge + Recent-view Move-to-bin. No architecture changes. No schema changes.

---

## 2. Scope

**In scope:**

### 2.1 API extension
- `GET /api/notes` accepts `?include=bins` query param. When present, response items have `bins: string[]` (sorted assignment IDs). When absent, response is unchanged (backward compatible for chat retrieval and any other caller).
- New query helper `listVaultNotesWithBins(limit?, binId?)` in `lib/queries/vault-notes.ts` returns notes with their assigned bin IDs via a single LEFT JOIN GROUP BY.
- Both `app/bins/page.tsx` (Recent view) and `app/bins/[id]/page.tsx` opt in via `?include=bins`, build a `Map<string, string[]>`, and pass as `noteBins` prop to `<NoteList>`.

### 2.2 Refactors
- New `lib/bins/tree.ts` exporting `findBinById` and `collectMatchingIds`. Replaces local copies in Sidebar, BinPicker, and BinTree.
- BinPicker's `childContainsMatch` deleted in favor of the shared `collectMatchingIds(bins, q, set)` + `set.has(b.id)` lookup. Same filter behavior in BinTree and BinPicker forever.
- Sidebar merge state consolidated into a single `MergeFlow` discriminated union (`idle | picking | confirming`). Replaces 4 separate state vars.
- `components/BinTree.tsx` split into `components/bin-tree/`:
  - `BinTree.tsx` — top wrapper (~90 lines)
  - `BinRow.tsx` — single row with rename + context menu + DnD wiring (~220 lines)
  - `DropStrip.tsx` — sibling drop target (~60 lines)
  - `sort-order.ts` — pure `computeNewSortOrder` (~25 lines)
  - `index.ts` — re-exports `BinTree` so call sites stay `from "./bin-tree"`

### 2.3 Server-side sort_order renumber
- New query helper `updateBinSortOrder(id, sort_order, parent_bin_id)` wraps the sort-bearing PATCH path inside a transaction:
  1. UPDATE the bin's sort_order (and parent_bin_id if changing)
  2. Run min-gap query against the (new) parent's siblings using SQLite window function `LAG`
  3. If `min_gap < 0.001` (or only one sibling present and we wrote a non-1000-multiple value), renumber that parent's children to `ROW_NUMBER() OVER (ORDER BY sort_order, id) * 1000.0`
- `app/api/bins/[id]/route.ts` PATCH handler routes sort_order-bearing requests through `updateBinSortOrder`, leaving rename and re-parent-without-sort calls on the existing `updateBin` path. No extra cost on rename/re-parent.

### 2.4 Polish
- **Typed error:** `class NoteNotInSourceBinError extends Error` exported from `lib/queries/bins.ts`. `moveNoteBetweenBins` throws it instead of `new Error("note not in source bin")`. `app/api/notes/[id]/move/route.ts` switches to `instanceof` check; the obsolete string-whitelist (commit `3280ea1`) is removed.
- **BinPicker keyboard nav:** ArrowDown / ArrowUp moves selection through visible flat list (post-filter, post-exclusion). Wraps at edges. Enter confirms. Esc already handled by Modal. Auto-scroll selected row into view.
- **Move/Remove toast wording:** Sidebar's move-bin success toast becomes `Moved 'X' to 'Y'` (or `'Top level'`). NoteList "Remove from this bin" toast becomes `Removed from 'binName'` — needs new optional `currentBinName` prop on `<NoteList>`, supplied by `app/bins/[id]/page.tsx`.

**Out of scope (deferred):**

- Picker tree a11y (`role="tree"` / `role="treeitem"` / `aria-expanded` / `aria-selected`) — solo-Tailscale app, low value
- Modal edge cases (zero focusable, single focusable) — theoretical
- ContextMenu arrow-key navigation — menus are ≤5 items, mouse is fast
- Client-side cycle detection during HTML5 dragover — bounded by `getData` limitation; server-side validation already correct
- Drop-indicator visual improvements — the cyan ring + red dashed are sufficient
- Frontend test infrastructure (RTL + jsdom) — still vitest node-env only
- Phase 4 deploy concerns (dev DB schema migration for v1.2.1's `sort_order REAL` change) — to be addressed when deploy planning starts

**Branch:** new `feature/v1.2.2-cleanup` off main (which now has v1.2 + v1.2.1 as of commit `023742a`).

---

## 3. Architecture

### 3.1 No architecture changes

This release does not introduce new layers, primitives, schemas, or external dependencies. All work is within the existing patterns:

- Query layer (`lib/queries/`) gains 2 functions and 1 typed error class.
- API route layer adds 1 query-param branch and switches one error-handling pattern.
- UI primitive layer is unchanged (Modal, ContextMenu untouched).
- Modal-component layer (Picker/Create/Delete/Merge) gains keyboard nav in Picker only.
- Bin-tree component is restructured into a directory but its external interface (`<BinTree>` import path stays via `index.ts` re-export) is unchanged.

### 3.2 Schema changes

**None.**

### 3.3 New files

- `lib/bins/tree.ts` — shared tree-walker utilities (`findBinById`, `collectMatchingIds`)
- `components/bin-tree/BinTree.tsx` — top wrapper after split
- `components/bin-tree/BinRow.tsx` — recursive row after extraction
- `components/bin-tree/DropStrip.tsx` — sibling drop target after extraction
- `components/bin-tree/sort-order.ts` — pure `computeNewSortOrder` after extraction
- `components/bin-tree/index.ts` — re-exports `BinTree` so call sites stay short
- `tests/lib/bins/tree.test.ts` — unit tests for the new utils
- `tests/lib/queries/vault-notes-with-bins.test.ts` — query-layer tests for `listVaultNotesWithBins` (or extend an existing vault-notes test file if one exists)
- `tests/app/api/notes/include-bins.test.ts` — route-layer test for `?include=bins`
- `tests/app/api/bins/sort-order-renumber.test.ts` — PATCH renumber regression test
- `tests/components/bin-tree/sort-order.test.ts` — unit tests for pure sort-order math

### 3.4 Modified files

- `lib/queries/bins.ts` — add `NoteNotInSourceBinError` class; update `moveNoteBetweenBins` to throw it; add `updateBinSortOrder` helper
- `lib/queries/vault-notes.ts` — add `listVaultNotesWithBins` helper
- `app/api/notes/route.ts` (or wherever GET handler lives) — branch on `?include=bins` query param
- `app/api/notes/[id]/move/route.ts` — switch to `instanceof NoteNotInSourceBinError` check; remove the whitelist comment
- `app/api/bins/[id]/route.ts` — route sort_order-bearing PATCH through `updateBinSortOrder`
- `app/bins/page.tsx` — fetch with `?include=bins`, build noteBins map, pass to NoteList
- `app/bins/[id]/page.tsx` — same as above; also pass `currentBinName` (already known from breadcrumb path state)
- `components/Sidebar.tsx` — replace 4 merge-state vars with `MergeFlow` union; use shared `findBinById`; update move toast to include destination
- `components/BinPicker.tsx` — delete `findBy` and `childContainsMatch`; import shared utils; add keyboard nav handler + selected-row scroll-into-view
- `components/NoteList.tsx` — accept new optional `currentBinName` prop; use it in Remove toast
- Delete `components/BinTree.tsx` — replaced by `components/bin-tree/` directory
- `tests/lib/queries/bins.test.ts` — extend with `NoteNotInSourceBinError` instance check + sort-order renumber test cases

---

## 4. API extension (`?include=bins`)

### 4.1 Route handler

`app/api/notes/route.ts` currently has:

```ts
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get("limit"), 200);
  const binId = searchParams.get("bin");
  const notes = binId ? listVaultNotesByBin(binId, limit) : listVaultNotes(limit);
  return NextResponse.json({ notes });
}
```

Add the `?include=bins` branch:

```ts
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = parseLimit(searchParams.get("limit"), 200);
  const binId = searchParams.get("bin");
  const includeBins = (searchParams.get("include") ?? "").split(",").includes("bins");

  let notes;
  if (includeBins) {
    notes = binId ? listVaultNotesByBinWithBins(binId, limit) : listVaultNotesWithBins(limit);
  } else {
    notes = binId ? listVaultNotesByBin(binId, limit) : listVaultNotes(limit);
  }
  return NextResponse.json({ notes });
}
```

### 4.2 Query helpers

Two new functions in `lib/queries/vault-notes.ts` — one mirrors `listVaultNotes`, the other mirrors `listVaultNotesByBin`. They differ only in the WHERE clause; share the SELECT/GROUP/ORDER body.

```ts
function buildNotesWithBinsRows(rows: Array<VaultNote & { bin_ids: string | null }>): Array<VaultNote & { bins: string[] }> {
  return rows.map(({ bin_ids, ...note }) => ({
    ...note,
    bins: bin_ids ? bin_ids.split(",").sort() : [],
  }));
}

/**
 * Like listVaultNotes(limit) but each note includes its assigned bin IDs.
 */
export function listVaultNotesWithBins(limit: number): Array<VaultNote & { bins: string[] }> {
  const rows = getDb().prepare(
    `SELECT vn.*, GROUP_CONCAT(nb.bin_id) AS bin_ids
     FROM vault_notes vn
     LEFT JOIN note_bins nb ON nb.note_id = vn.id
     WHERE vn.deleted_at IS NULL
     GROUP BY vn.id
     ORDER BY vn.modified_at DESC
     LIMIT ?`
  ).all(limit) as Array<VaultNote & { bin_ids: string | null }>;
  return buildNotesWithBinsRows(rows);
}

/**
 * Like listVaultNotesByBin(binId, limit) but each note includes its assigned bin IDs.
 */
export function listVaultNotesByBinWithBins(binId: string, limit: number): Array<VaultNote & { bins: string[] }> {
  const rows = getDb().prepare(
    `SELECT vn.*, GROUP_CONCAT(nb.bin_id) AS bin_ids
     FROM vault_notes vn
     LEFT JOIN note_bins nb ON nb.note_id = vn.id
     WHERE vn.deleted_at IS NULL
       AND vn.id IN (SELECT note_id FROM note_bins WHERE bin_id = ?)
     GROUP BY vn.id
     ORDER BY vn.modified_at DESC
     LIMIT ?`
  ).all(binId, limit) as Array<VaultNote & { bin_ids: string | null }>;
  return buildNotesWithBinsRows(rows);
}
```

(Spread cast is loose because `vn.*` selects the full vault_notes row + the synthetic `bin_ids`. The implementer can tighten the type if `VaultNote` has stricter shape than what `vn.*` returns. The shape returned matches the existing `VaultNote` exactly, plus the new `bins` field.)

### 4.3 Page integration

In `app/bins/page.tsx` (Recent view):

```ts
const [noteBins, setNoteBins] = useState<Map<string, string[]>>(new Map());

useEffect(() => {
  setLoading(true);
  fetch("/api/notes?include=bins&limit=100")
    .then((r) => r.json())
    .then((d) => {
      setNotes(d.notes ?? []);
      setNoteBins(new Map((d.notes ?? []).map((n: { id: string; bins: string[] }) => [n.id, n.bins ?? []])));
    })
    .finally(() => setLoading(false));
}, [refreshKey]);

<NoteList
  /* existing props */
  noteBins={noteBins}
/>
```

In `app/bins/[id]/page.tsx`: same pattern, but the existing fetch uses `/api/notes?bin=${id}&limit=500`. Change to `/api/notes?bin=${id}&include=bins&limit=500`. Build noteBins map from the response. Pass `currentBinName={path.at(-1) ?? ""}` (existing breadcrumb state).

### 4.4 Tests

`tests/app/api/notes/include-bins.test.ts`:
1. Without `?include=bins`: response notes have no `bins` field. (Backward-compat sanity.)
2. With `?include=bins`, note in 0 bins: `bins: []`.
3. With `?include=bins`, note in 2 bins: `bins` contains both bin IDs (use `expect.arrayContaining` since order doesn't matter beyond sorted-string-comparison).

`tests/lib/queries/vault-notes-with-bins.test.ts` (new file or extend existing): same 3 cases at the query-layer.

---

## 5. Refactors

### 5.1 `lib/bins/tree.ts`

```ts
import type { BinNode } from "../types";

/**
 * Recursively find a bin in a tree by ID. Returns null if not found.
 */
export function findBinById(bins: BinNode[], id: string): BinNode | null {
  for (const b of bins) {
    if (b.id === id) return b;
    const c = b.children ? findBinById(b.children, id) : null;
    if (c) return c;
  }
  return null;
}

/**
 * Walk the tree adding any bin to `out` whose name (or any descendant's name)
 * contains `q` (case-insensitive). Returns true if any match was found at
 * this level. Used by BinTree (for visibility filtering) and BinPicker (same).
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
```

(Moved from `components/BinTree.tsx`. Extracted version passes `qLower` to recursive calls instead of `q`, eliminating redundant `toLowerCase()` calls in deep recursion. Behavior is identical because `toLowerCase()` is idempotent.)

### 5.2 BinPicker uses the shared util

In `components/BinPicker.tsx`:
- Delete `findBy` (lines ~36-44 of current file). **Note the argument order swap:** existing call sites use `findBy(id, bins)` but the new shared helper is `findBinById(bins, id)` — flip args at every call site (typically inside `excludeIds.forEach((id) => findBinById(bins, id))`).
- Delete `childContainsMatch` (lines ~159-163).
- Import `findBinById, collectMatchingIds` from `@/lib/bins/tree`.
- Pre-compute `visibleIds` once (when `filter` is non-empty) using `collectMatchingIds`, then `<PickableTree>` checks `visibleIds.has(b.id)` instead of recursively calling `childContainsMatch` on every render.
- `excludedSet` computation continues to use `findBinById` for each `excludeIds[i]`.

This removes the O(N²) walker the code reviewer flagged.

### 5.3 Merge state discriminated union

In `components/Sidebar.tsx`, replace:

```ts
const [mergeBinSource, setMergeBinSource] = useState<BinNode | null>(null);
const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
const [mergeTargetName, setMergeTargetName] = useState<string>("");
const [mergePickerOpen, setMergePickerOpen] = useState(false);
```

with:

```ts
type MergeFlow =
  | { phase: "idle" }
  | { phase: "picking"; source: BinNode }
  | { phase: "confirming"; source: BinNode; target: { id: string; name: string } };

const [merge, setMerge] = useState<MergeFlow>({ phase: "idle" });
```

Update render gates:
- `merge.phase === "picking" && <BinPicker source={merge.source} ... />`
- `merge.phase === "confirming" && <MergeBinModal sourceId={merge.source.id} sourceName={merge.source.name} targetId={merge.target.id} targetName={merge.target.name} ... />`

Update handlers:
- `onRequestMerge={(bin) => setMerge({ phase: "picking", source: bin })}`
- BinPicker `onPick={(targetId) => { if (!targetId) return; const target = findBinById(bins, targetId); setMerge({ phase: "confirming", source: merge.source /* TS-checked */, target: { id: targetId, name: target?.name ?? "?" } }); }}`
- MergeBinModal `onClose={() => setMerge({ phase: "idle" })}` and `onMerged={(targetId) => { onSelectBin(targetId); setMerge({ phase: "idle" }); setRefreshKey(k => k + 1); }}`

The narrowing inside the picker's `onPick` requires the closure to capture `merge` after a discriminant check — handle by inlining: `if (merge.phase !== "picking") return;` at the top, or use a type-guard.

### 5.4 BinTree split

Each new file owns one concern. Imports between them are local (`./BinRow`, `./DropStrip`, `./sort-order`).

- **`components/bin-tree/sort-order.ts`** — pure functions only. No React.

  ```ts
  import type { BinNode } from "@/lib/types";
  export function computeNewSortOrder(prev: BinNode | null, before: BinNode | null, last: BinNode | null): number {
    if (prev && before) return ((prev.sort_order ?? 0) + (before.sort_order ?? 0)) / 2;
    if (!prev && before) return (before.sort_order ?? 0) - 1000;
    if (last) return (last.sort_order ?? 0) + 1000;
    return 0;
  }
  ```

- **`components/bin-tree/DropStrip.tsx`** — the strip component. Imports `useDrop` from `@/lib/dnd`, `useToast` from `@/components/chat/ToastProvider`, `computeNewSortOrder` from `./sort-order`. Same body as today's DropStrip with the post-T23 error toast wiring (commit `7e1e314`).

- **`components/bin-tree/BinRow.tsx`** — the recursive row. Owns `editing` / `editValue` / `editError` state, `useDrag`, `useDrop`, `useIsCommandHeld`, `useContextMenu`, `useToast`. Imports `DropStrip` from `./DropStrip` (for its own children's sibling list). Renders nested `<BinRow>` for each child, wrapped with `<DropStrip>` separators.

- **`components/bin-tree/BinTree.tsx`** — top entry. Owns `visibleIds` memo (using shared `collectMatchingIds`). Renders the top-level sibling list with leading + trailing `DropStrip`s. Imports `BinRow` from `./BinRow`.

- **`components/bin-tree/index.ts`**:
  ```ts
  export { BinTree } from "./BinTree";
  export type { BinTreeProps } from "./BinTree";
  ```

- **`components/Sidebar.tsx`** — change import: `from "./BinTree"` → `from "./bin-tree"`.

- **Delete `components/BinTree.tsx`** at the end.

### 5.5 Tests

`tests/lib/bins/tree.test.ts`:
- `findBinById`: 5 cases (direct, deep, missing, empty list, single bin)
- `collectMatchingIds`: 4 cases (no match, single deep match, multiple matches at different levels, empty query — assert empty set per existing convention if applicable)

`tests/components/bin-tree/sort-order.test.ts`:
- 4 cases for `computeNewSortOrder`: between two siblings (returns average), at start (returns first - 1000), at end (returns last + 1000), empty list (returns 0).
- First time `computeNewSortOrder` has any unit coverage.

---

## 6. Server-side sort_order renumber

### 6.1 Query helper

In `lib/queries/bins.ts`:

```ts
const RENUMBER_GAP_THRESHOLD = 1e-7;

/**
 * Atomically updates a bin's sort_order (and optionally parent_bin_id) and
 * triggers a renumber of the affected parent's children if the smallest sibling
 * gap drops below RENUMBER_GAP_THRESHOLD. Returns the updated bin.
 */
export function updateBinSortOrder(
  id: string,
  input: { sort_order: number; parent_bin_id?: string | null }
): Bin | null {
  const db = getDb();
  const tx = db.transaction(() => {
    const existing = getBinById(id);
    if (!existing) return null;

    const newParent = input.parent_bin_id === undefined
      ? existing.parent_bin_id
      : input.parent_bin_id;

    db.prepare(
      "UPDATE bins SET sort_order = ?, parent_bin_id = ? WHERE id = ?"
    ).run(input.sort_order, newParent, id);

    // Find smallest sibling gap under the new parent.
    const gapRow = db.prepare(
      `WITH ordered AS (
         SELECT sort_order,
                LAG(sort_order) OVER (ORDER BY sort_order, id) AS prev
         FROM bins
         WHERE (parent_bin_id IS ? OR (parent_bin_id IS NULL AND ? IS NULL))
       )
       SELECT MIN(sort_order - prev) AS min_gap
       FROM ordered WHERE prev IS NOT NULL`
    ).get(newParent, newParent) as { min_gap: number | null };

    if (gapRow.min_gap !== null && gapRow.min_gap < RENUMBER_GAP_THRESHOLD) {
      // Renumber to clean 1000-spaced values, preserving relative order
      // (sort_order, id) — id breaks ties.
      db.prepare(
        `UPDATE bins
         SET sort_order = (
           SELECT new_order FROM (
             SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, id) * 1000.0 AS new_order
             FROM bins
             WHERE (parent_bin_id IS ? OR (parent_bin_id IS NULL AND ? IS NULL))
           ) AS r WHERE r.id = bins.id
         )
         WHERE (parent_bin_id IS ? OR (parent_bin_id IS NULL AND ? IS NULL))`
      ).run(newParent, newParent, newParent, newParent);
    }

    return getBinById(id);
  });
  return tx();
}
```

### 6.2 Route integration

In `app/api/bins/[id]/route.ts` PATCH handler, before the existing `updateBin` call, add:

```ts
// Sort-order changes go through the renumber-aware path.
if (b.sort_order !== undefined && typeof b.sort_order === "number") {
  // (cycle-validation block already runs above this — preserved)
  const updated = updateBinSortOrder(params.id, {
    sort_order: b.sort_order,
    parent_bin_id: b.parent_bin_id === undefined
      ? undefined
      : (b.parent_bin_id as string | null),
  });
  return NextResponse.json({ bin: updated });
}
// Else fall through to existing updateBin path (rename or re-parent without sort).
```

The `merge_into` branch and DELETE seeded-bin guard are unaffected.

### 6.3 Threshold rationale

`RENUMBER_GAP_THRESHOLD = 1e-7`. Balances two failure modes:

- **Too high** (e.g., 0.001): renumbers fire after ~20 reorders into the same gap (each halving 1000 → 500 → 250 → ... → 0.0009 takes log2(1000/0.001) ≈ 20 steps). For a user actively reordering bins, 20 drags into the same slot is a realistic session — extra silent UPDATEs aren't broken but they're wasteful.
- **Too low** (e.g., 1e-12): only fires at actual precision-loss territory. By the time the gap is that small, intermediate `(prev + before) / 2` results may equal one of the endpoints, making the next reorder a silent no-op.

`1e-7` sits comfortably between: ~33 halvings of a 1000 starting gap (effectively never reached in normal use) but still ~5 orders of magnitude above IEEE-754 double precision for numbers in the 1000 range. Lowering further gains nothing; raising it triggers renumbers earlier than necessary but doesn't break correctness.

### 6.4 Behavior

- **Pure reorder under same parent:** query runs, occasionally renumbers (silently — sidebar refetches, user sees no toast).
- **Re-parent (sort_order to new parent):** query runs against the **new** parent's siblings.
- **Rename only / cycle reject / DELETE / merge:** unaffected.

### 6.5 Tests

Extend `tests/lib/queries/bins.test.ts` with `describe("updateBinSortOrder gap renumber", ...)`:

1. **No renumber when gap is healthy.** Insert 3 siblings at 1000, 2000, 3000. Update middle to 1500. Expect final sort_orders to be [1000, 1500, 3000] (no renumber fired).
2. **Renumber when gap collapses.** Insert 3 siblings at 1000, 1000.00000005, 1000.0000001. Update middle to 1000.00000006 (gap < 1e-7). Expect final sort_orders to be integer multiples of 1000 (1000, 2000, 3000) with relative order preserved.
3. **Single-child case.** Only one sibling under parent. Update sort_order. `min_gap` is null → no renumber, no error.
4. **Tiebreaker on equal sort_order.** Force two siblings to identical sort_order via raw SQL. Trigger a renumber by writing a third value that collapses a gap. Both originally-tied bins get distinct values; the lower-`id` one comes first.

`tests/app/api/bins/sort-order-renumber.test.ts` (new file):
1. Happy path: PATCH with a sort_order that triggers renumber. Assert response is 200 and the underlying DB shows clean 1000-multiples.

---

## 7. Polish

### 7.1 Typed error class

```ts
// lib/queries/bins.ts
export class NoteNotInSourceBinError extends Error {
  constructor(public readonly noteId: string, public readonly fromBinId: string) {
    super(`Note ${noteId} not in source bin ${fromBinId}`);
    this.name = "NoteNotInSourceBinError";
  }
}

// In moveNoteBetweenBins, replace:
//   if (!inSource) throw new Error("note not in source bin");
// with:
//   if (!inSource) throw new NoteNotInSourceBinError(noteId, fromBinId);
```

`app/api/notes/[id]/move/route.ts`:

```ts
} catch (err) {
  if (err instanceof NoteNotInSourceBinError) {
    return NextResponse.json({ error: "note not in source bin" }, { status: 400 });
  }
  // Unknown error: don't leak details.
  return NextResponse.json({ error: "move failed" }, { status: 500 });
}
```

(Note the change: unknown errors return 500 now, not 400. The whitelist-against-string approach was returning 400 for everything; the typed approach lets us distinguish "this is a known business-logic failure" (400) from "something unexpected blew up" (500). UI's existing toast handling treats both the same for the user, so no UI change.)

The whitelist-against-string code from commit `3280ea1` is removed.

Tests: extend `tests/lib/queries/bins.test.ts`'s `moveNoteBetweenBins` block to assert `expect(() => ...).toThrow(NoteNotInSourceBinError)` instead of `toThrow(/not in source bin/)`. Extend `tests/app/api/bins/move-note.test.ts` with one case asserting the 500 path on a non-NoteNotInSourceBinError condition (e.g., simulate a different throw — possibly via mocking, or by constructing a scenario like a foreign key violation).

### 7.2 BinPicker keyboard navigation

Add to `components/BinPicker.tsx`:

```tsx
// Build a flat list of selectable bin IDs (and null for top-level pseudo-row)
// in render-display order, respecting filter and exclusion. Memoize.
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

// Keyboard handler on the modal body div.
function handleKeyDown(e: React.KeyboardEvent) {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const currentIdx = selectableIds.indexOf(selected);
    const delta = e.key === "ArrowDown" ? 1 : -1;
    const len = selectableIds.length;
    if (len === 0) return;
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
```

After `setSelected`, scroll the matching row into view using `data-bin-id` attributes:

```tsx
useEffect(() => {
  if (selected === undefined) return;
  const el = bodyRef.current?.querySelector(`[data-bin-id="${selected ?? "__top__"}"]`) as HTMLElement | null;
  el?.scrollIntoView({ block: "nearest" });
}, [selected]);
```

Each pickable row (and the top-level pseudo-row) gets `data-bin-id={b.id}` (or `data-bin-id="__top__"` for the pseudo-row).

The Modal body div itself doesn't accept keydown unless given `tabIndex={-1}`; add it. Modal's existing focus-trap focuses the first focusable on open — the first focusable is the filter input, so typing into the filter still works. Arrow keys on the filter input bubble up to the modal handler (`onKeyDown` on the wrapping div).

No automated tests (vitest is node env). Manual smoke covers it.

### 7.3 Move/Remove toast wording

`components/Sidebar.tsx` (in the move-bin BinPicker `onPick`):

```ts
const targetName = targetId ? findBinById(bins, targetId)?.name ?? "?" : "Top level";
toast.show(`Moved '${moveBin.name}' to '${targetName}'`, "info");
```

`components/NoteList.tsx`:
- Add new optional prop `currentBinName?: string`
- In the Remove handler, change toast from `"Removed from bin"` to `\`Removed from '${currentBinName ?? "bin"}'\``

`app/bins/[id]/page.tsx` passes `currentBinName={path.at(-1) ?? ""}` (the breadcrumb's last segment is the current bin name — already in scope).

`app/bins/page.tsx` (Recent view) doesn't have a current bin, doesn't pass `currentBinName`. The Remove option isn't shown on Recent view anyway (gated by `currentBinId`).

---

## 8. Files

### 8.1 New files (12)

- `lib/bins/tree.ts`
- `components/bin-tree/BinTree.tsx`
- `components/bin-tree/BinRow.tsx`
- `components/bin-tree/DropStrip.tsx`
- `components/bin-tree/sort-order.ts`
- `components/bin-tree/index.ts`
- `tests/lib/bins/tree.test.ts`
- `tests/lib/queries/vault-notes-with-bins.test.ts` (or extend existing)
- `tests/app/api/notes/include-bins.test.ts`
- `tests/app/api/bins/sort-order-renumber.test.ts`
- `tests/components/bin-tree/sort-order.test.ts`

### 8.2 Modified files

- `lib/queries/bins.ts` — `NoteNotInSourceBinError`, `updateBinSortOrder`
- `lib/queries/vault-notes.ts` — `listVaultNotesWithBins`
- `app/api/notes/route.ts` — branch on `?include=bins`
- `app/api/notes/[id]/move/route.ts` — `instanceof` typed-error check
- `app/api/bins/[id]/route.ts` — route sort_order PATCH through `updateBinSortOrder`
- `app/bins/page.tsx` — fetch `?include=bins`, build noteBins map
- `app/bins/[id]/page.tsx` — same + pass `currentBinName`
- `components/Sidebar.tsx` — `MergeFlow` discriminated union, shared `findBinById`, move toast wording, `from "./bin-tree"` import
- `components/BinPicker.tsx` — shared utils, keyboard nav, scroll-into-view
- `components/NoteList.tsx` — accept `currentBinName`, use in Remove toast
- `tests/lib/queries/bins.test.ts` — typed-error assertion + sort-order renumber suite

### 8.3 Deleted files

- `components/BinTree.tsx` — replaced by directory

---

## 9. Roadmap context

This is **v1.2.2**, a cleanup release between v1.2.1 (manual bin management) and v1.3 (whole-note auto-classify agent).

**Why now and not later:**
- v1.3 will add a third caller of the bin-tree-walker functions (the classifier review modal needs to look up suggested bins by ID and surface paths). Extracting `findBinById` now means v1.3 doesn't repeat the duplication-then-extract dance.
- v1.3 will likely add UI elements to BinRow (classifier-proposed-bin badges, confirmation buttons). Splitting BinTree.tsx now means v1.3's edits land in a 220-line BinRow.tsx instead of a 600-line BinTree.tsx.
- The multi-bin badge `·N` becoming visible may change how the user thinks about bin organization — useful information to have before v1.3 starts proposing bin assignments.

**Why not earlier:**
- These items only became cleanup-shaped after v1.2.1's integration revealed the duplication and the wired-but-unfed props. Doing them inside v1.2.1 would have inflated that scope.

---

## 10. Open questions

None at spec time. All design decisions resolved during brainstorm:

| Decision | Choice |
|---|---|
| `noteBins` API shape | `?include=bins` opt-in on existing `/api/notes` |
| BinTree split | Per-concern files (BinTree / BinRow / DropStrip / sort-order) |
| Sort-order renumber location | Server-side, transparent on PATCH |
| Polish scope | Typed error, picker keyboard nav, shared filter walker, move/remove toast wording |

---

## 11. Acceptance criteria

v1.2.2 is done when all of these are true:

1. ☐ `GET /api/notes?include=bins` returns each note with a `bins: string[]` field; without `?include=bins`, response is unchanged
2. ☐ Multi-bin badge `·N` renders on note rows in `/bins` and `/bins/[id]` for notes assigned to >1 bin
3. ☐ "Move to bin…" context-menu item appears on Recent view for notes in exactly 1 bin
4. ☐ `findBinById` and `collectMatchingIds` live in `lib/bins/tree.ts`; Sidebar, BinPicker, and BinTree all use them; local copies removed
5. ☐ Sidebar merge state is a single `MergeFlow` discriminated union; impossible states unrepresentable
6. ☐ `components/bin-tree/` exists with the 4 files + index.ts; `components/BinTree.tsx` deleted
7. ☐ `components/Sidebar.tsx` imports BinTree from `./bin-tree` (or `./bin-tree/index`)
8. ☐ Sort-order PATCH transparently renumbers when sibling gap collapses below 1e-7
9. ☐ `NoteNotInSourceBinError` typed class used end-to-end (throw in query, `instanceof` in route)
10. ☐ BinPicker supports ArrowUp / ArrowDown / Enter for keyboard navigation
11. ☐ Move-bin toast says `Moved 'X' to 'Y'`; Remove-from-bin toast says `Removed from 'binName'`
12. ☐ All previously-passing tests (189) still pass; ~20 new tests added
13. ☐ Build, lint, typecheck all clean
14. ☐ Manual smoke checklist (§7's behaviors plus T25-style spot checks) passes
