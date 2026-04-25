# Manual Bin Management UI Design Spec (v1.2.1)

**Date:** 2026-04-25
**Status:** Draft, awaiting Kimi audit
**Builds on:** `docs/superpowers/specs/2026-04-24-agent-first-redesign-design.md` (v1.2)

---

## 1. Motivation

v1.2 shipped a fully redesigned chat-primary UI with a persistent bin-tree sidebar — but the bin tree is **read-only**. Today the only ways to create or modify bins are: (a) Quick Capture's bin picker (creates flat top-level bins), or (b) `getOrCreateBinBySeed` called automatically by `sync-notion`. There is no UI to:

- Create a child bin (nest the hierarchy)
- Rename a bin
- Delete a bin
- Merge two bins
- Move a note from one bin to another
- Reorganize the tree (re-parent, reorder)

This blocks the user's "deep hierarchies" vision (`content/japan/reels/ideas`) and blocks v1.3 (auto-classify) — a classifier needs a real bin hierarchy to target. v1.2.1 is the prerequisite that gives the user agency over their structure before any agent does the binning.

**v1.2.1 is intentionally narrow.** It is a UI layer over APIs that mostly already exist (one new endpoint + one query bug fix). No new architecture, no schema changes.

---

## 2. Scope

**In scope:**

- Three new reusable UI primitives: `<Modal>`, `<ContextMenu>`, hoisted `<ToastProvider>` (currently scoped to chat page only)
- Sidebar mutations:
  - "+ new bin" button at top of sidebar tree → Modal with name field, creates top-level bin
  - Right-click bin row → context menu: New child bin / Rename (inline) / Move bin… / Merge into… / Delete
  - Inline rename in the tree (Esc cancels, Enter commits)
  - Bin Picker modal (reused for set-parent / move / merge target)
- Note row mutations (in `/bins`, `/bins/[id]`, anywhere a `<NoteList>` appears):
  - Right-click note → context menu: Open / Add to bin… / Move to bin… / Remove from this bin
  - Multi-bin badge (`·N`) on note rows when assigned to >1 bin
- Drag-and-drop:
  - Note row → sidebar bin = **Add** (POST assign)
  - Note row + ⌘ → sidebar bin = **Move** (new atomic move endpoint)
  - Sidebar bin → sidebar bin = **Re-parent** (PATCH parent_bin_id)
  - Sidebar bin → between siblings = **Reorder** (PATCH sort_order)
  - Drop indicators (cyan ring on bin rows, cyan line between rows, red dashed for invalid)
- Confirmation modals:
  - Delete with blast-radius preview (counts of children + assigned notes)
  - Merge with note + sub-bin re-parent disclosure
- Three new API endpoints: `POST /api/notes/[id]/move` (atomic move), `GET /api/bins/[id]/preview-delete`, `GET /api/bins/[id]/preview-merge`
- Server-side guard on `DELETE /api/bins/[id]` for seeded bins (defense in depth — UI also hides the menu item)
- One bug fix in `mergeBin`: re-parent source bin's children to target (currently they would cascade-delete)
- Cycle-detection helper for move/re-parent (reject if target is self or descendant)
- One small schema change: `bins.sort_order` from `INTEGER` to `REAL` to support fractional drag-reorder values without truncation
- Tests: extended `tests/lib/queries/bins.test.ts` + new `tests/app/api/bins/` directory (using relative imports — vitest config has no `@/` alias plugin)

**Out of scope (deferred):**

- Multi-select bulk operations (drag is one-note-at-a-time)
- Drag from one bin's content view onto another bin's content view (cross-page nav)
- Context menus on chat citation chips
- Inbox-style separation of `notion-sync` bin (deferred to v1.4 when segment extraction makes a dedicated inbox earn its keep)
- React component testing infrastructure (no RTL / jsdom event simulation)
- v1.3 auto-classify agent (separate spec)
- v1.4 atomic segment extraction (separate spec)

---

## 3. Architecture

### 3.1 New primitives

**`<Modal>`** (`components/Modal.tsx`)

Generic overlay component. API:

```tsx
<Modal open={isOpen} onClose={() => setOpen(false)} title="…" size="sm" | "md" | "lg">
  {children}
  <ModalFooter>
    <button onClick={onClose}>Cancel</button>
    <button onClick={onConfirm}>Confirm</button>
  </ModalFooter>
</Modal>
```

Mechanics:
- `fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center`
- Click backdrop → calls `onClose`
- Esc → calls `onClose` (window keydown listener registered while open)
- Inner div has `onClick={(e) => e.stopPropagation()}` and `role="dialog" aria-modal="true"`
- Pattern starts from existing `components/QuickCapture.tsx` overlay; adds focus trap below
- **Focus management** (manual implementation, ~30 lines, no dependency):
  - On open: store `document.activeElement` as `previousFocus`. Find first focusable element inside the modal via `querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')` and `.focus()` it.
  - On Tab: if `e.target` is the last focusable element, `e.preventDefault()` and focus the first. On Shift+Tab from the first, focus the last. Use a single keydown handler on the modal root.
  - On close: call `previousFocus?.focus()` to restore.
  - On open: set `document.body.style.overflow = "hidden"` to prevent background scroll. Restore on close.
- Add `aria-labelledby={titleId}` pointing at the modal's title element.

**`<ContextMenu>`** (`components/ContextMenu.tsx`)

Portal-rendered popover. API:

```tsx
const menu = useContextMenu();
// In JSX:
<div onContextMenu={(e) => menu.open(e, [
  { label: "Rename", action: handleRename },
  { label: "Delete", action: handleDelete, danger: true },
  { label: "Disabled item", action: () => {}, disabled: true },
])}>
```

Mechanics:
- Renders into a `<div id="context-menu-root" />` mounted in `app/layout.tsx`
- Positioned at `event.clientX, event.clientY`, clamped to viewport edges
- Closes on outside-click, Esc, item click
- One menu instance at a time (provider holds the open state)
- Items render with `font-mono uppercase tracking-wide text-xs` (matches existing JetBrains Mono labels)
- Danger items render in red

**Hoisted `<ToastProvider>`**

Currently mounted in `app/page.tsx` (the chat page). Move to `app/layout.tsx` so it wraps all routes. Existing `useToast()` consumers in chat unchanged.

### 3.2 New API endpoints

**`POST /api/notes/[id]/move`**

Atomic move of a single note from one bin to another.

```ts
// Request:
{ from_bin_id: string, to_bin_id: string }
// Response 200:
{ ok: true }
// Response 400:
{ error: "note not in source bin" }
// Response 404:
{ error: "bin not found" }
```

Implementation: a single SQLite transaction wrapping `unassignNoteFromBin(from)` + `assignNoteToBin(to)` (with `assigned_by: "manual"`). Both run or neither. Lives in a new `lib/queries/bins.ts` function `moveNoteBetweenBins(noteId, fromBinId, toBinId)`.

**`GET /api/bins/[id]/preview-delete`**

Returns counts used by the **delete** confirmation dialog. Read-only, idempotent.

```ts
// Response 200:
{
  child_bin_count: number,           // total descendants (recursive)
  child_bin_names: string[],         // first 5 immediate children, alphabetical
  has_more_children: boolean,        // true if > 5 immediate children
  note_count: number                 // distinct notes with ≥1 assignment to this bin or any descendant
}
```

Implementation: new query `getBinDeletePreview(id)`. `note_count` is the count of distinct notes that have at least one `note_bins` row pointing to this bin or any descendant. A note appearing in multiple bins-being-deleted is counted once. Notes in unrelated bins are unaffected by the delete and not counted.

**`GET /api/bins/[id]/preview-merge`**

Returns counts used by the **merge** confirmation dialog. Different scope than `preview-delete` because merging only re-parents children; it doesn't delete them.

```ts
// Response 200:
{
  direct_child_count: number,        // immediate children only (will be re-parented to target)
  direct_note_count: number          // notes assigned directly to this bin (will be re-assigned to target)
}
```

Implementation: new query `getBinMergePreview(id)`. `direct_child_count` counts rows in `bins` where `parent_bin_id = id` (no recursion — sub-bins keep their identity). `direct_note_count` counts rows in `note_bins` where `bin_id = id` (no recursion — sub-bins' notes stay with the sub-bins).

The two preview endpoints are intentionally separate because the counting semantics differ enough that conflating them via a query parameter (`?mode=delete|merge`) would be a bug magnet.

### 3.3 API changes (no new endpoint)

**`PATCH /api/bins/[id]` with `parent_bin_id`** — add cycle validation. Today the route accepts `parent_bin_id` and writes it directly. Add server-side check: reject with 400 if `parent_bin_id` equals the bin's own ID, or if the bin appears anywhere in the descendant chain of the new parent. Use a new helper `isDescendantOf(maybeChild, ancestor)` in `lib/queries/bins.ts`.

**`PATCH /api/bins/[id]` with `merge_into`** — fix `mergeBin` to re-parent source's children to target. Today the cascade FK on `parent_bin_id` would delete them, which is wrong for a merge. Update the query to:

```sql
-- inside the existing mergeBin transaction, before DELETE FROM bins:
UPDATE bins SET parent_bin_id = ? WHERE parent_bin_id = ?;
-- ^ target_id              ^ source_id
```

**`DELETE /api/bins/[id]`** — add seeded-bin server-side guard. Today the route deletes any bin by ID with no protection. The UI hides the Delete menu item for bins with `source_seed != null`, but a malformed/buggy client could still call DELETE directly and destroy a seeded bin (e.g., the `notion-sync` inbox). Fix:

```ts
// in app/api/bins/[id]/route.ts DELETE handler, before deletion:
const existing = getBinById(id);
if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
if (existing.source_seed) {
  return NextResponse.json({ error: "seeded bins cannot be deleted" }, { status: 403 });
}
```

UI surfaces the 403 as a toast: "Cannot delete a synced bin." This guard is the only operation blocked server-side; rename, re-parent, merge-into, and create-children of seeded bins all remain allowed (matches the Q7 design choice).

### 3.4 Schema changes

**One small change.** Update `sort_order` column type from `INTEGER` to `REAL` in `lib/schema.sql`:

```sql
-- Before:
sort_order INTEGER NOT NULL DEFAULT 0
-- After:
sort_order REAL NOT NULL DEFAULT 0
```

Reason: client-side averaging for drag-reorder produces fractional values that INTEGER would truncate, causing collisions after ~10 consecutive reorders in the same gap. SQLite's REAL preserves the precision indefinitely at the user's expected scale.

This is a non-destructive type change. No migration needed for an empty/default column — SQLite preserves all current `0` values cleanly. If the dev DB has any existing non-zero `sort_order` values, they'd be preserved as REAL. Cycle detection is still enforced in code, not schema.

---

## 4. Sidebar bin operations

### 4.1 "+ new bin" button

Rendered next to the search input at the top of the sidebar tree (above `<BinTree>`). Icon: small `+` from `components/icons.tsx` style. Click → opens "Create bin" Modal.

**Create bin Modal:**
- Header: "New bin" (or "New child bin" if launched from a context menu with a parent)
- Body: single text input ("Bin name"), autofocused
- Footer: Cancel / Create
- Enter in input commits
- Validation:
  - Empty → Create button disabled
  - Length > 120 → inline error below input ("Too long — max 120 characters"), Create disabled
- On commit: `POST /api/bins` with `{ name, parent_bin_id }`. Server returns `{ bin }`. UI:
  - Refetch `/api/bins` (returns the full tree)
  - Select the new bin (sets `selectedBinId` in layout state)
  - Close modal
  - Toast: "Created '{name}'"

### 4.2 Right-click context menu on bin row

Items in order:

| Item | Visibility | Action |
|---|---|---|
| New child bin | Always | Opens Create bin Modal with `parent_bin_id` = this bin |
| Rename | Always | Replaces row name with `<input>`, autofocused & text-selected. Esc cancels (reverts), Enter or blur commits. PATCH `/api/bins/[id]` with `{ name }`. Same validation as create. Toast on success |
| Move bin… | Always | Opens Bin Picker modal. On confirm: PATCH `/api/bins/[id]` with `{ parent_bin_id: picked }`. Picker offers "Top level (no parent)" pseudo-row. Toast on success |
| Merge into… | Always | Opens Bin Picker modal. On confirm: opens Merge confirmation modal. PATCH on confirm |
| Delete | Hidden if `source_seed != null` | Opens Delete confirmation modal |

### 4.3 Bin Picker modal

Reused for: Move bin…, Merge into…, Add note to bin…, Move note to bin…. **Not used for "+ new bin"** — that flow creates a top-level bin with no parent picker (§4.1). "New child bin" from a bin's context menu also skips the picker because the parent is implicit (the right-clicked bin).

UX:
- Header: contextual ("Move 'Reels' to…" / "Merge 'Drafts' into…" / "Add to bin…" / "Move to bin…" / "Pick a parent")
- Body:
  - Search input on top (filters tree, collapsing non-matching branches and expanding matches — same pattern as existing sidebar search)
  - `<BinTree>` below (same component as the sidebar). Click a row to select. Selected row gets cyan ring.
  - For "Move bin…" only: a "Top level (no parent)" pseudo-row is rendered above the tree.
  - Empty bin tree: shows "No bins yet — create one first" with a Cancel button only.
- Footer: Cancel / Confirm. Confirm disabled until a row is selected.
- Invalid targets:
  - For "Move bin…" / "Merge into…": the bin being acted on, and all its descendants, render greyed-out and not-selectable. Tooltip: "Can't move into itself or a child."
  - For "Add to bin…" / "Move to bin…": bins the note is already in render with a small "(already here)" suffix; for "Add" they're disabled, for "Move" they're disabled if it's the current bin context (the source).
- Esc closes (treated as Cancel).
- "Top level (no parent)" pseudo-row: rendered as a styled `<button>` above the BinTree component, only when picker is launched in "Move bin…" mode. It's a sibling visual element of the BinTree, not an entry in the tree itself. Selecting it sets `parent_bin_id: null` on confirm.

### 4.4 Reorder via drag

Within the same parent, dragging a bin row up/down shows a horizontal drop indicator between rows. Drop → PATCH `/api/bins/[id]` with a single `{ sort_order }` value.

**Sort order strategy:** client-side averaging on a REAL-typed column (see §3.4). When dropped between two siblings with sort_orders A and B, the new value is `(A + B) / 2`. When dropped at the start, `first_sibling.sort_order - 1000`. When dropped at the end, `last_sibling.sort_order + 1000`. Initial values from existing bins are `0, 1000, 2000, …` (assigned on creation). This avoids server-side renumbering and, with REAL precision, supports tens of thousands of reorders in any gap before float precision becomes a concern.

### 4.5 Inline rename

Right-click → Rename. (No double-click trigger — single-click is reserved for select, and adding double-click invites accidental edits.) The `<span>` becomes an `<input>` with current name preselected. Input is `font-mono uppercase tracking-wide text-xs` matching the existing label style.

- Esc → revert and exit edit mode
- Enter → commit
- Blur (click elsewhere) → commit (matches Finder)
- Validation errors render inline below the input ("Name required" / "Too long"), input stays open

---

## 5. Note operations & drag-and-drop

### 5.1 Right-click context menu on note row

Triggered on `<NoteList>` rows. Items:

| Item | Visibility | Action |
|---|---|---|
| Open | Always | Opens ReadingPane (same as click) |
| Add to bin… | Always | Bin Picker modal → POST `/api/bins/[picked]/assign` with `{ note_id }`. Toast: "Added to '{name}'" |
| Move to bin… | Only when source bin is unambiguous (on `/bins/[id]`, or note is in exactly one bin) | Bin Picker modal → POST `/api/notes/[id]/move` with `from_bin_id` = current bin context (when on `/bins/[id]`) or the note's only bin (when on Recent view). Toast: "Moved to '{name}'". Hidden on `/bins` Recent view when the note is uncategorized or has multiple bins (use Add to + Remove from manually) |
| Remove from this bin | Only when on `/bins/[id]` page | DELETE `/api/bins/[currentBin]/assign/[noteId]`. Toast: "Removed from '{name}'" |

### 5.2 Multi-bin badge

When a note's `bins.length > 1`, render a small `·N` badge in the row's right side (where `N` is total bin count). Style: `font-mono text-xs text-text-secondary`. Hover shows a tooltip listing the bin paths. When N is 1, no badge.

### 5.3 Drag-and-drop semantics

| Source | Drop target | Modifier | Effect | API |
|---|---|---|---|---|
| Note row | Sidebar bin row | (none) | **Add** | `POST /api/bins/[target]/assign` |
| Note row | Sidebar bin row | ⌘ held, source bin unambiguous | **Move** | `POST /api/notes/[id]/move` |
| Note row | Sidebar bin row | ⌘ held, source bin ambiguous | **Add (fallback)** + warning toast | `POST /api/bins/[target]/assign` |
| Sidebar bin row | Sidebar bin row | (none) | **Re-parent** | `PATCH /api/bins/[id]` `{ parent_bin_id }` |
| Sidebar bin row | Between siblings | (none) | **Reorder** | `PATCH /api/bins/[id]` `{ sort_order }` |

**Source-bin disambiguation** (mirrors §5.1's rule for the Move context menu item — both code paths must agree):

- "Source bin unambiguous" means: the user is on `/bins/[id]` (the page itself supplies the source bin), OR the note has exactly 1 bin assignment.
- "Source bin ambiguous" means: the user is on `/bins` (Recent view) AND the note has 0 or >1 bin assignments.

When the source is ambiguous and the user holds ⌘ on drop, fall back to **Add** behavior and show a toast: `"Hold ⌘ to move only when a single source bin is clear"`. The drop indicator stays cyan (drop is allowed); only the post-drop toast informs the user that Move was downgraded.

This rule is enforced in the same `useDrop` handler (§5.7) — read the modifier state from `dataTransfer.dropEffect` or a sibling React state, branch into Add or Move based on the disambiguation check.

### 5.4 Drop indicators

- **On a bin row** (re-parent or assign): row gets a 2px `border-accent` ring (cyan)
- **Between bin rows** (reorder): a 2px cyan horizontal line at drop position, spanning row width
- **Invalid drop** (cycle, drop on self): row gets `border-red-500 border-dashed` ring; cursor `not-allowed`

### 5.5 Drag preview

Native HTML5 drag with `setDragImage` of a cloned node at 80% scale, 70% opacity. The cloned node mirrors the row's content (icon + name).

### 5.6 Modifier hint

While dragging a note, render a small pill in the bottom-right of the viewport: "Add" (default) or "Move" (when ⌘ is held). Updates live as the modifier toggles. Pill style: `font-mono text-xs px-2 py-1 bg-raised border border-border rounded-md`.

### 5.7 Implementation note

Native HTML5 drag-and-drop API with a small `useDrag/useDrop` hook abstraction (~50-80 lines). No `react-dnd` or `dnd-kit` dependency — the codebase has avoided libraries for this kind of thing.

The hook covers:
- `dragstart` (sets payload via `dataTransfer.setData("application/x-dashboard", JSON.stringify({ kind: "note" | "bin", id }))`)
- `dragover` (enables drop, sets `dataTransfer.dropEffect`)
- `dragenter`/`dragleave` (drop indicator state)
- `drop` (parses payload, calls handler)

ESC during drag = cancel (native browser behavior).

---

## 6. Confirmations

### 6.1 Delete confirmation modal

Triggered from right-click → Delete on a non-seeded bin.

**Empty bin** (no children, no notes): one-line confirmation.

```
Delete "Notes/Drafts"?
                          [ Cancel ]  [ Delete ]
```

**Non-empty bin**: blast-radius preview.

```
Delete "Reels"?

This will:
 • Delete 3 sub-bins (japan, tokyo, kyoto)
 • Unassign 47 notes (notes themselves stay in vault)

This cannot be undone.

                          [ Cancel ]  [ Delete ]
```

- Counts come from `GET /api/bins/[id]/preview-delete`
- Up to 5 child bin names listed inline; > 5 shows "…and N more"
- Delete button is red, default focus is Cancel
- Notes are explicitly noted as preserved in the vault — only the assignment is removed
- On confirm: DELETE `/api/bins/[id]` → close modal → toast: "Deleted '{name}' and {N} sub-bins" (or just "'{name}'" for empty bins) → if the deleted bin was selected, fall back to its parent (or root)

### 6.2 Merge confirmation modal

Triggered after the user picks a target in the Merge into… Bin Picker.

```
Merge "Drafts" into "Notes/Inbox"?

This will:
 • Move 23 notes from "Drafts" to "Notes/Inbox"
 • Delete the empty "Drafts" bin

⚠ Sub-bins of "Drafts" (2) will be re-parented to "Notes/Inbox".
This cannot be undone.

                          [ Cancel ]  [ Merge ]
```

- Note count is **direct assignments to source bin only** — sub-bins are re-parented (not merged), so their notes stay with the sub-bins. Counts come from `GET /api/bins/[id]/preview-merge` (separate from `preview-delete` — see §3.2)
- Sub-bin warning only shown when source has direct children. Lists the count of immediate children only (not recursive — re-parenting only affects direct children)
- On confirm: PATCH `/api/bins/[source]` with `{ merge_into: target_id }` → close modals → toast: "Merged '{source}' into '{target}'" → if source was selected, select target

---

## 7. Edge cases

| Case | Behavior |
|---|---|
| Empty bin tree (first-time user, no bins yet) | Sidebar shows "No bins yet" + "Create your first bin" CTA in the BinTree area. Hides search input |
| Network failure on any operation | Error toast: "Failed to {action}: {server message or 'unknown'}". Optimistic UI rolls back |
| Stale tree after multi-tab edit | Refetch `/api/bins` on `window.focus`. Cheap; one round-trip |
| Drag a bin onto its own descendant | Block at drop time (drop indicator turns red dashed). If the API gets called anyway, server returns 400 and toast surfaces it |
| Rename to a name that already exists at the same level | Allowed. No uniqueness constraint in the schema beyond `source_seed`. Sibling bins can share names |
| Create child of a seeded bin | Allowed. Children of seeded bins are not themselves seeded |
| Delete the bin currently selected | Selection falls back to the deleted bin's parent (or root if no parent) |
| Move a bin to the same parent it already has | No-op; treat as success silently |
| Try to move/merge a bin into itself | Blocked client-side (greyed in picker), 400 if server is somehow called |
| Reorder a bin to its current position | No-op; treat as success silently |
| Drag note onto a bin it's already in (no ⌘) | No-op; show subtle toast "Already in '{name}'" |
| Drag note onto a bin it's already in (with ⌘ for move) | Treat as no-op (would unassign-then-assign the same row) |

---

## 8. Testing approach

### 8.1 Query layer (`tests/lib/queries/bins.test.ts`)

Extend existing test file with:

- `mergeBin` re-parents source's children to target (the bug fix)
- `mergeBin` is idempotent on note conflicts (note already in target — confirms `ON CONFLICT DO NOTHING`)
- `getBinDeletePreview(id)` returns correct counts for: empty bin, bin with notes only, bin with children only, deeply nested bin
- `isDescendantOf(maybeChild, ancestor)` returns correct true/false for: direct child, grandchild, sibling, self, unrelated
- `moveNoteBetweenBins(noteId, fromBinId, toBinId)` is atomic (no orphan state on partial failure — simulate by passing invalid `toBinId`)

### 8.2 API route tests (`tests/app/api/bins/`) — first time these routes get coverage

Test harness: same `resetDbForTesting()` pattern as queries, plus a thin wrapper to invoke route handlers directly. **Use relative imports, not `@/` alias** — the existing `vitest.config.ts` does not include `vite-tsconfig-paths`, and all current tests use relative paths. Adding the alias plugin is out of scope for this spec.

```ts
// Use relative paths matching existing tests/lib/queries/bins.test.ts style:
import { POST } from "../../../../app/api/notes/[id]/move/route";
const res = await POST(
  new Request("http://x", { method: "POST", body: JSON.stringify({ from_bin_id, to_bin_id }) }),
  { params: { id: noteId } }
);
```

Coverage:
- `POST /api/notes/[id]/move` — happy path; 400 if `from_bin_id` doesn't have the note; 404 if either bin doesn't exist
- `PATCH /api/bins/[id]` with `parent_bin_id` — rejects cycle (target = self) and (target = descendant) with 400
- `PATCH /api/bins/[id]` with `merge_into` — children get re-parented (regression coverage for §3.3 bug fix)
- `GET /api/bins/[id]/preview-delete` — returns expected counts; doesn't actually delete
- `GET /api/bins/[id]/preview-merge` — returns direct-only counts; doesn't actually merge
- `DELETE /api/bins/[id]` for a seeded bin — returns 403 with the documented error message; bin still exists after the call

### 8.3 Manual smoke test (before merge)

A checklist in the implementation plan listing the click-paths to walk:

1. Create a top-level bin
2. Right-click → New child bin → create a child
3. Right-click → Rename, type a new name, Enter
4. Right-click → Rename, Esc → name reverts
5. Drag a bin onto another bin → re-parents
6. Drag a bin between siblings → reorders
7. Drag a bin onto its own child → red dashed indicator, drop blocked
8. Right-click note → Add to bin → picker → confirm → toast
9. Right-click note → Move to bin → picker → confirm → note disappears from current view
10. Drag note onto sidebar bin → toast "Added"
11. Hold ⌘, drag note onto sidebar bin → toast "Moved", multi-bin badge updates
12. Right-click bin → Merge into → picker → confirm dialog → confirm → source bin gone
13. Right-click bin with children → Delete → preview shows correct counts → confirm
14. Right-click `notion-sync` bin → Delete is hidden; Rename works
15. Empty bin tree state — delete all bins → "+ Create your first bin" CTA appears

### 8.4 What is NOT tested

- Drag-and-drop interactions (no React component testing infrastructure)
- Modal/ContextMenu primitives (visually verified instead)
- Inline rename keyboard handling
- Drop indicator visuals

These are caught in §8.3 manual smoke test.

**Test count target:** ~12-15 new tests. Brings the suite from ~160 to ~175 passing.

---

## 9. Files

### 9.1 New files

- `components/Modal.tsx` — generic overlay with focus trap (§3.1)
- `components/ContextMenu.tsx` — portal-positioned context menu + provider hook
- `components/BinPicker.tsx` — modal wrapping the BinTree with search + Confirm/Cancel
- `components/CreateBinModal.tsx` — name input modal for create
- `components/DeleteBinModal.tsx` — blast-radius confirmation
- `components/MergeBinModal.tsx` — merge confirmation
- `lib/dnd.ts` — `useDrag/useDrop` hooks for HTML5 drag-and-drop abstraction
- `app/api/notes/[id]/move/route.ts` — atomic move endpoint
- `app/api/bins/[id]/preview-delete/route.ts` — counts for delete confirmation
- `app/api/bins/[id]/preview-merge/route.ts` — counts for merge confirmation
- `tests/app/api/bins/move-note.test.ts`
- `tests/app/api/bins/preview-delete.test.ts`
- `tests/app/api/bins/preview-merge.test.ts`
- `tests/app/api/bins/cycle-validation.test.ts`
- `tests/app/api/bins/merge-children.test.ts` (regression for §3.3 bug fix)
- `tests/app/api/bins/seeded-bin-protection.test.ts` (regression for §3.3 DELETE guard)

### 9.2 Modified files

- `app/layout.tsx` — mount `<ToastProvider>` here (hoist from page.tsx); mount `<div id="context-menu-root" />` for portals
- `app/page.tsx` — remove the `<ToastProvider>` wrapper (now in layout)
- `components/Sidebar.tsx` — add "+ new bin" button next to search; integrate context menu state; integrate drop targets on bin rows
- `components/BinTree.tsx` — add right-click handler per row; add inline rename state; add drag handle (whole row is draggable); add drop indicator visuals
- `components/NoteList.tsx` — add right-click handler per row; add multi-bin badge; add `draggable` per row
- `app/api/bins/[id]/route.ts` — add cycle validation in PATCH path with `parent_bin_id`; PATCH with `merge_into` triggers updated `mergeBin`; DELETE adds seeded-bin guard returning 403
- `lib/queries/bins.ts` — add `getBinDeletePreview`, `getBinMergePreview`, `isDescendantOf`, `moveNoteBetweenBins`; update `mergeBin` to re-parent children
- `lib/schema.sql` — change `sort_order INTEGER` to `sort_order REAL` (one column, two-token edit)
- `tests/lib/queries/bins.test.ts` — extend with §8.1 cases

---

## 10. Roadmap context

This is **v1.2.1**, the next phase after v1.2 (agent-first redesign). It unblocks:

- **v1.3** — Whole-note auto-classify agent. Needs a real bin hierarchy to target. Without v1.2.1 the user can't build that hierarchy in the UI.
- **v1.4** — Atomic segment extraction. Needs both v1.2.1 (manual UI) and v1.3 (classifier) before it makes sense.

The "manual" in the title is intentional — the agent does nothing here. Everything the user does is direct manipulation. v1.3 is when the agent starts proposing bins; v1.4 is when it starts extracting ideas.

---

## 11. Open questions

None at spec time. All design decisions resolved during brainstorm:

| Decision | Choice |
|---|---|
| Delete semantics | Confirm with blast-radius preview |
| Trigger style | Right-click context menus only (no hover ⋯ buttons) |
| Picker UX | Outline tree in modal (same as sidebar pattern) |
| Drag scope | Notes + bin re-parent + bin reorder |
| Multi-bin model | Allowed; drag = Add, ⌘+drag = Move (with ambiguous-source fallback) |
| Seeded bins (`notion-sync`) | Rename allowed, Delete hidden + 403 server guard — revisit at v1.4 |

### 11.1 Kimi audit changes

Kimi's audit on 2026-04-25 surfaced 3 blockers + 5 concerns; all patched into this revision:

- §3.1 — Modal focus trap fully specified (was hand-wave)
- §3.2 — Separate `preview-merge` endpoint (was conflated with `preview-delete`)
- §3.3 — DELETE seeded-bin server guard added (was UI-only — security gap)
- §3.4 — `sort_order` switched to REAL (INTEGER would truncate fractional averages)
- §4.3 — Bin Picker reuse list cleaned up (no parent picker on "+ new bin")
- §5.3 — ⌘-drag ambiguous-source fallback defined (was "skip if no source bin context")
- §8.2 — Test imports use relative paths (vitest has no `@/` alias plugin)

---

## 12. Acceptance criteria

v1.2.1 is done when:

1. The user can create a 5-level-deep bin hierarchy entirely from the sidebar, no API calls or DB tools required
2. Right-clicking any bin shows the full menu (or the seeded-bin variant for `notion-sync`)
3. Right-clicking any note row shows the move/add/remove menu
4. Dragging a note onto a sidebar bin adds it; ⌘-drag moves it
5. Dragging a bin onto another bin re-parents; dragging within siblings reorders
6. Deleting a non-empty bin shows the preview with correct counts
7. Merging a bin re-parents its children to the target (regression-tested)
8. All existing 160 tests still pass; ~12-15 new tests added
9. Manual smoke test (§8.3) passes
10. Build, lint, typecheck all clean
