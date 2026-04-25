# v1.2.1 Manual Bin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UI for create/rename/delete/merge bins, move/add notes between bins, with right-click context menus and HTML5 drag-and-drop.

**Architecture:** Three new reusable UI primitives (Modal, ContextMenu, hoisted ToastProvider) + four modal components (CreateBin, BinPicker, DeleteBin, MergeBin) + a small useDrag/useDrop hook layer. Most APIs already exist; we add three (atomic move, preview-delete, preview-merge), fix one bug in mergeBin, and add server-side guards for cycle prevention and seeded-bin deletion. One small schema change: sort_order INTEGER → REAL to support fractional drag-reorder values.

**Tech Stack:** Next.js 14 App Router, better-sqlite3, native HTML5 drag-and-drop API, Tailwind CSS, vitest (node env). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-25-manual-bin-management-design.md`

**Branch:** Continue on `feature/thought-organizer-v12` (do not branch off this work).

---

## File Structure

**New files:**
- `lib/dnd.ts` — useDrag/useDrop hooks + isCommandHeld tracker
- `components/Modal.tsx` — generic overlay with focus trap
- `components/ContextMenu.tsx` — portal-positioned context menu + provider hook
- `components/CreateBinModal.tsx` — name input modal for create
- `components/BinPicker.tsx` — modal wrapping BinTree with search + Confirm/Cancel
- `components/DeleteBinModal.tsx` — blast-radius confirmation
- `components/MergeBinModal.tsx` — merge confirmation
- `app/api/notes/[id]/move/route.ts` — atomic move endpoint
- `app/api/bins/[id]/preview-delete/route.ts` — counts for delete confirmation
- `app/api/bins/[id]/preview-merge/route.ts` — counts for merge confirmation
- `tests/app/api/bins/move-note.test.ts`
- `tests/app/api/bins/preview-delete.test.ts`
- `tests/app/api/bins/preview-merge.test.ts`
- `tests/app/api/bins/cycle-validation.test.ts`
- `tests/app/api/bins/merge-children.test.ts`
- `tests/app/api/bins/seeded-bin-protection.test.ts`

**Modified files:**
- `lib/schema.sql` — sort_order INTEGER → REAL
- `lib/queries/bins.ts` — add `getBinDeletePreview`, `getBinMergePreview`, `isDescendantOf`, `moveNoteBetweenBins`; fix `mergeBin`
- `app/api/bins/[id]/route.ts` — cycle validation in PATCH; seeded-bin guard in DELETE
- `app/layout.tsx` — mount ToastProvider; mount context-menu-root div
- `app/page.tsx` — remove ToastProvider wrapper (now in layout)
- `components/Sidebar.tsx` — add "+ new bin" button next to search
- `components/BinTree.tsx` — context menu, inline rename, drop targets, drag source, drop indicators
- `components/NoteList.tsx` — context menu, multi-bin badge, draggable rows
- `components/icons.tsx` — add `PlusIcon`
- `tests/lib/queries/bins.test.ts` — extend with new query tests

---

## Task index

| # | Task | Layer |
|---|---|---|
| 1 | Schema: sort_order INTEGER → REAL | Foundation |
| 2 | Query: `isDescendantOf` | Foundation |
| 3 | Query: `moveNoteBetweenBins` | Foundation |
| 4 | Bug fix: `mergeBin` re-parents children | Foundation |
| 5 | Query: `getBinDeletePreview` | Foundation |
| 6 | Query: `getBinMergePreview` | Foundation |
| 7 | API: POST /api/notes/[id]/move | API |
| 8 | API: GET /api/bins/[id]/preview-delete | API |
| 9 | API: GET /api/bins/[id]/preview-merge | API |
| 10 | API: DELETE seeded-bin guard | API |
| 11 | API: PATCH cycle validation | API |
| 12 | Icon: PlusIcon | UI primitive |
| 13 | Component: Modal | UI primitive |
| 14 | Component: ContextMenu | UI primitive |
| 15 | Layout: hoist ToastProvider + context-menu-root | UI primitive |
| 16 | Component: CreateBinModal | Modal |
| 17 | Component: BinPicker | Modal |
| 18 | Component: DeleteBinModal | Modal |
| 19 | Component: MergeBinModal | Modal |
| 20 | Hook: useDrag/useDrop in lib/dnd.ts | DnD |
| 21 | Sidebar: + new bin button | Sidebar |
| 22 | BinTree: context menu + inline rename | Sidebar |
| 23 | BinTree: drag-and-drop (re-parent, reorder, drop indicators) | Sidebar |
| 24 | NoteList: context menu + multi-bin badge + drag source | Notes |
| 25 | Manual smoke test + lint/typecheck/test gate | Final |

---

## Task 1: Schema sort_order INTEGER → REAL

**Files:**
- Modify: `lib/schema.sql:73`
- Test: `tests/lib/queries/bins.test.ts` (add assertion)

- [ ] **Step 1: Write the failing test**

SQLite uses dynamic typing — INTEGER affinity columns will store `1500.5` without truncating (only TEXT→numeric coercion is strict). So a value-roundtrip test would pass under both INTEGER and REAL. Instead, assert the **declared schema type** via `PRAGMA table_info`, which is the actual contract we care about.

Add this test inside the existing `describe("bins queries", () => {...})` block in `tests/lib/queries/bins.test.ts`:

```ts
it("schema declares bins.sort_order as REAL for fractional drag-reorder", () => {
  const db = getDb();
  const cols = db.prepare("PRAGMA table_info(bins)").all() as Array<{ name: string; type: string }>;
  const sortOrder = cols.find((c) => c.name === "sort_order");
  expect(sortOrder?.type).toBe("REAL");
});
```

Add `getDb` to imports in the test file:

```ts
import { getDb } from "../../../lib/db";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "REAL for fractional"`

Expected: FAIL — column type is currently `INTEGER`. Test message will show `expected "INTEGER" to be "REAL"`.

- [ ] **Step 3: Edit `lib/schema.sql` line 73**

Change:
```sql
  sort_order INTEGER DEFAULT 0
```
to:
```sql
  sort_order REAL DEFAULT 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "REAL for fractional"`

Expected: PASS — schema declares REAL.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm test`

Expected: All previously passing tests still pass (160 + 1 new = 161).

- [ ] **Step 6: Commit**

```bash
git add lib/schema.sql tests/lib/queries/bins.test.ts
git commit -m "feat(schema): bins.sort_order INTEGER → REAL for fractional drag-reorder"
```

---

## Task 2: Query helper `isDescendantOf`

**Files:**
- Modify: `lib/queries/bins.ts` (append a new exported function)
- Test: `tests/lib/queries/bins.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe("bins queries", () => {...})` block:

```ts
describe("isDescendantOf", () => {
  it("returns true for direct child", () => {
    const parent = createBin({ name: "P" });
    const child = createBin({ name: "C", parent_bin_id: parent.id });
    expect(isDescendantOf(child.id, parent.id)).toBe(true);
  });
  it("returns true for grandchild", () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B", parent_bin_id: a.id });
    const c = createBin({ name: "C", parent_bin_id: b.id });
    expect(isDescendantOf(c.id, a.id)).toBe(true);
  });
  it("returns false for sibling", () => {
    const parent = createBin({ name: "P" });
    const a = createBin({ name: "A", parent_bin_id: parent.id });
    const b = createBin({ name: "B", parent_bin_id: parent.id });
    expect(isDescendantOf(a.id, b.id)).toBe(false);
  });
  it("returns false for self", () => {
    const a = createBin({ name: "A" });
    expect(isDescendantOf(a.id, a.id)).toBe(false);
  });
  it("returns false for unrelated bins", () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    expect(isDescendantOf(a.id, b.id)).toBe(false);
  });
});
```

Add `isDescendantOf` to the imports list at the top of the test file:

```ts
import {
  createBin, getBinById, listBins, listBinTree,
  updateBin, deleteBin, assignNoteToBin, unassignNoteFromBin,
  listBinsForNote, mergeBin, getOrCreateBinBySeed,
  isDescendantOf,  // NEW
} from "../../../lib/queries/bins";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "isDescendantOf"`

Expected: FAIL — `isDescendantOf is not a function` (or import error).

- [ ] **Step 3: Implement `isDescendantOf` in `lib/queries/bins.ts`**

Append to `lib/queries/bins.ts`:

```ts
/**
 * Returns true if `maybeChild` is a descendant of `ancestor` in the bin tree.
 * Returns false for self, siblings, and unrelated bins.
 */
export function isDescendantOf(maybeChild: string, ancestor: string): boolean {
  if (maybeChild === ancestor) return false;
  const rows = getDb()
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM bins WHERE parent_bin_id = ?
         UNION ALL
         SELECT b.id FROM bins b JOIN descendants d ON b.parent_bin_id = d.id
       )
       SELECT 1 FROM descendants WHERE id = ? LIMIT 1`
    )
    .get(ancestor, maybeChild);
  return !!rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "isDescendantOf"`

Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/bins.ts tests/lib/queries/bins.test.ts
git commit -m "feat(queries): add isDescendantOf for cycle detection"
```

---

## Task 3: Query function `moveNoteBetweenBins`

**Files:**
- Modify: `lib/queries/bins.ts`
- Test: `tests/lib/queries/bins.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/queries/bins.test.ts`:

```ts
describe("moveNoteBetweenBins", () => {
  it("moves a note from source to target atomically", () => {
    const noteRow = upsertVaultNote({
      vault_path: "test/note1.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    assignNoteToBin({ note_id: noteRow.id, bin_id: a.id, assigned_by: "manual" });
    moveNoteBetweenBins(noteRow.id, a.id, b.id);
    const bins = listBinsForNote(noteRow.id).map((x) => x.id);
    expect(bins).toEqual([b.id]);
  });

  it("throws if note is not in source bin", () => {
    const noteRow = upsertVaultNote({
      vault_path: "test/note2.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    expect(() => moveNoteBetweenBins(noteRow.id, a.id, b.id)).toThrow(/not in source bin/);
  });
});
```

Add `nowIso` to imports at the top of the test file:

```ts
import { nowIso } from "../../../lib/utils";
```

Add `moveNoteBetweenBins` to the imports from bins:

```ts
import {
  // …existing…
  moveNoteBetweenBins,
} from "../../../lib/queries/bins";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "moveNoteBetweenBins"`

Expected: FAIL — `moveNoteBetweenBins is not a function`.

- [ ] **Step 3: Implement `moveNoteBetweenBins` in `lib/queries/bins.ts`**

Append to `lib/queries/bins.ts`:

```ts
/**
 * Atomically moves a note from one bin to another in a single transaction.
 * Throws if the note is not in the source bin.
 */
export function moveNoteBetweenBins(
  noteId: string,
  fromBinId: string,
  toBinId: string
): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const inSource = db
      .prepare("SELECT 1 FROM note_bins WHERE note_id = ? AND bin_id = ? LIMIT 1")
      .get(noteId, fromBinId);
    if (!inSource) throw new Error("note not in source bin");
    db.prepare("DELETE FROM note_bins WHERE note_id = ? AND bin_id = ?").run(noteId, fromBinId);
    db.prepare(
      `INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(note_id, bin_id) DO NOTHING`
    ).run(noteId, toBinId, nowIso(), "manual");
  });
  tx();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "moveNoteBetweenBins"`

Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/bins.ts tests/lib/queries/bins.test.ts
git commit -m "feat(queries): add moveNoteBetweenBins atomic transaction"
```

---

## Task 4: Bug fix — `mergeBin` re-parents children before delete

**Files:**
- Modify: `lib/queries/bins.ts:131-143` (the `mergeBin` function)
- Test: `tests/lib/queries/bins.test.ts`

- [ ] **Step 1: Write the failing regression test**

Append to `tests/lib/queries/bins.test.ts`:

```ts
describe("mergeBin re-parents children", () => {
  it("preserves source's children by re-parenting them to target", () => {
    const source = createBin({ name: "Drafts" });
    const target = createBin({ name: "Notes" });
    const child1 = createBin({ name: "WIP", parent_bin_id: source.id });
    const child2 = createBin({ name: "Old", parent_bin_id: source.id });
    mergeBin(source.id, target.id);
    expect(getBinById(source.id)).toBeNull();
    expect(getBinById(child1.id)?.parent_bin_id).toBe(target.id);
    expect(getBinById(child2.id)?.parent_bin_id).toBe(target.id);
  });
  it("still merges note assignments idempotently", () => {
    const noteRow = upsertVaultNote({
      vault_path: "test/note-merge.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const source = createBin({ name: "S" });
    const target = createBin({ name: "T" });
    assignNoteToBin({ note_id: noteRow.id, bin_id: source.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: noteRow.id, bin_id: target.id, assigned_by: "manual" });
    mergeBin(source.id, target.id);
    const bins = listBinsForNote(noteRow.id).map((x) => x.id);
    expect(bins).toEqual([target.id]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "mergeBin re-parents"`

Expected: FAIL — first test fails because children cascade-deleted (getBinById returns null).

- [ ] **Step 3: Update `mergeBin` in `lib/queries/bins.ts`**

Replace the existing `mergeBin` function (lines ~131-143) with:

```ts
export function mergeBin(source_id: string, target_id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by)
       SELECT note_id, ?, assigned_at, assigned_by FROM note_bins WHERE bin_id = ?
       ON CONFLICT(note_id, bin_id) DO NOTHING`
    ).run(target_id, source_id);
    db.prepare("DELETE FROM note_bins WHERE bin_id = ?").run(source_id);
    // Re-parent source's direct children to target before delete.
    // Without this, the FK ON DELETE CASCADE would destroy them.
    db.prepare("UPDATE bins SET parent_bin_id = ? WHERE parent_bin_id = ?").run(target_id, source_id);
    db.prepare("DELETE FROM bins WHERE id = ?").run(source_id);
  });
  tx();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "mergeBin"`

Expected: PASS — both new tests AND the existing `mergeBin` tests still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/bins.ts tests/lib/queries/bins.test.ts
git commit -m "fix(queries): mergeBin re-parents source's children to target"
```

---

## Task 5: Query function `getBinDeletePreview`

**Files:**
- Modify: `lib/queries/bins.ts`
- Test: `tests/lib/queries/bins.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/queries/bins.test.ts`:

```ts
describe("getBinDeletePreview", () => {
  it("returns zero counts for an empty bin", () => {
    const bin = createBin({ name: "Empty" });
    const preview = getBinDeletePreview(bin.id);
    expect(preview).toEqual({
      child_bin_count: 0,
      child_bin_names: [],
      has_more_children: false,
      note_count: 0,
    });
  });
  it("counts direct + recursive descendants", () => {
    const root = createBin({ name: "Root" });
    const c1 = createBin({ name: "alpha", parent_bin_id: root.id });
    const c2 = createBin({ name: "bravo", parent_bin_id: root.id });
    createBin({ name: "grand", parent_bin_id: c1.id });
    const preview = getBinDeletePreview(root.id);
    expect(preview.child_bin_count).toBe(3); // c1 + c2 + grand
    expect(preview.child_bin_names).toEqual(["alpha", "bravo"]);
    expect(preview.has_more_children).toBe(false);
  });
  it("limits child_bin_names to first 5 alphabetical and sets has_more_children", () => {
    const root = createBin({ name: "Root" });
    ["e", "d", "c", "b", "a", "g", "f"].forEach((n) =>
      createBin({ name: n, parent_bin_id: root.id })
    );
    const preview = getBinDeletePreview(root.id);
    expect(preview.child_bin_names).toEqual(["a", "b", "c", "d", "e"]);
    expect(preview.has_more_children).toBe(true);
  });
  it("counts distinct notes once even if assigned to multiple descendants", () => {
    const noteRow = upsertVaultNote({
      vault_path: "test/dist.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const root = createBin({ name: "Root" });
    const a = createBin({ name: "A", parent_bin_id: root.id });
    const b = createBin({ name: "B", parent_bin_id: root.id });
    assignNoteToBin({ note_id: noteRow.id, bin_id: a.id, assigned_by: "manual" });
    assignNoteToBin({ note_id: noteRow.id, bin_id: b.id, assigned_by: "manual" });
    expect(getBinDeletePreview(root.id).note_count).toBe(1);
  });
});
```

Add to imports:
```ts
import {
  // …existing…
  getBinDeletePreview,
} from "../../../lib/queries/bins";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "getBinDeletePreview"`

Expected: FAIL — `getBinDeletePreview is not a function`.

- [ ] **Step 3: Implement `getBinDeletePreview`**

Append to `lib/queries/bins.ts`:

```ts
export interface BinDeletePreview {
  child_bin_count: number;
  child_bin_names: string[];
  has_more_children: boolean;
  note_count: number;
}

/**
 * Returns counts used by the delete confirmation dialog.
 * Notes counted once even if assigned to multiple descendants.
 */
export function getBinDeletePreview(id: string): BinDeletePreview {
  const db = getDb();
  // Recursive descendants (does not include self)
  const descendants = db
    .prepare(
      `WITH RECURSIVE d(id) AS (
         SELECT id FROM bins WHERE parent_bin_id = ?
         UNION ALL
         SELECT b.id FROM bins b JOIN d ON b.parent_bin_id = d.id
       )
       SELECT id FROM d`
    )
    .all(id) as { id: string }[];
  const child_bin_count = descendants.length;

  // Immediate children, alphabetical, first 5 + has-more flag
  const immediate = db
    .prepare("SELECT name FROM bins WHERE parent_bin_id = ? ORDER BY name COLLATE NOCASE ASC")
    .all(id) as { name: string }[];
  const child_bin_names = immediate.slice(0, 5).map((r) => r.name);
  const has_more_children = immediate.length > 5;

  // Distinct notes assigned to this bin OR any descendant
  const allBinIds = [id, ...descendants.map((d) => d.id)];
  const placeholders = allBinIds.map(() => "?").join(",");
  const noteRow = db
    .prepare(
      `SELECT COUNT(DISTINCT note_id) AS n FROM note_bins WHERE bin_id IN (${placeholders})`
    )
    .get(...allBinIds) as { n: number };
  const note_count = noteRow.n;

  return { child_bin_count, child_bin_names, has_more_children, note_count };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "getBinDeletePreview"`

Expected: PASS — all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/bins.ts tests/lib/queries/bins.test.ts
git commit -m "feat(queries): add getBinDeletePreview"
```

---

## Task 6: Query function `getBinMergePreview`

**Files:**
- Modify: `lib/queries/bins.ts`
- Test: `tests/lib/queries/bins.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/lib/queries/bins.test.ts`:

```ts
describe("getBinMergePreview", () => {
  it("counts only direct children and direct note assignments", () => {
    const noteRow = upsertVaultNote({
      vault_path: "test/merge-pv.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const root = createBin({ name: "Root" });
    const directChild = createBin({ name: "Direct", parent_bin_id: root.id });
    createBin({ name: "Grand", parent_bin_id: directChild.id }); // NOT counted
    assignNoteToBin({ note_id: noteRow.id, bin_id: root.id, assigned_by: "manual" });
    const preview = getBinMergePreview(root.id);
    expect(preview.direct_child_count).toBe(1);
    expect(preview.direct_note_count).toBe(1);
  });
  it("returns zero counts for empty bin", () => {
    const bin = createBin({ name: "Empty" });
    expect(getBinMergePreview(bin.id)).toEqual({ direct_child_count: 0, direct_note_count: 0 });
  });
});
```

Add to imports:
```ts
import {
  // …existing…
  getBinMergePreview,
} from "../../../lib/queries/bins";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "getBinMergePreview"`

Expected: FAIL — `getBinMergePreview is not a function`.

- [ ] **Step 3: Implement `getBinMergePreview`**

Append to `lib/queries/bins.ts`:

```ts
export interface BinMergePreview {
  direct_child_count: number;
  direct_note_count: number;
}

/**
 * Returns counts used by the merge confirmation dialog.
 * Direct only — sub-bins keep identity (not merged), so their notes stay with them.
 */
export function getBinMergePreview(id: string): BinMergePreview {
  const db = getDb();
  const c = db
    .prepare("SELECT COUNT(*) AS n FROM bins WHERE parent_bin_id = ?")
    .get(id) as { n: number };
  const n = db
    .prepare("SELECT COUNT(*) AS n FROM note_bins WHERE bin_id = ?")
    .get(id) as { n: number };
  return { direct_child_count: c.n, direct_note_count: n.n };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "getBinMergePreview"`

Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add lib/queries/bins.ts tests/lib/queries/bins.test.ts
git commit -m "feat(queries): add getBinMergePreview"
```

---

## Task 7: API endpoint POST /api/notes/[id]/move

**Files:**
- Create: `app/api/notes/[id]/move/route.ts`
- Test: `tests/app/api/bins/move-note.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/api/bins/move-note.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, assignNoteToBin, listBinsForNote } from "../../../../lib/queries/bins";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { nowIso } from "../../../../lib/utils";
import { POST } from "../../../../app/api/notes/[id]/move/route";

const TEST_DB = path.join(process.cwd(), "data", "test-move-note.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("POST /api/notes/[id]/move", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("moves a note from source bin to target bin (200)", async () => {
    const note = upsertVaultNote({
      vault_path: "x.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    assignNoteToBin({ note_id: note.id, bin_id: a.id, assigned_by: "manual" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ from_bin_id: a.id, to_bin_id: b.id }) });
    const res = await POST(req, { params: { id: note.id } });
    expect(res.status).toBe(200);
    const ids = listBinsForNote(note.id).map((x) => x.id);
    expect(ids).toEqual([b.id]);
  });

  it("returns 400 if note is not in source bin", async () => {
    const note = upsertVaultNote({
      vault_path: "y.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ from_bin_id: a.id, to_bin_id: b.id }) });
    const res = await POST(req, { params: { id: note.id } });
    expect(res.status).toBe(400);
  });

  it("returns 404 if a bin is missing", async () => {
    const note = upsertVaultNote({
      vault_path: "z.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    const a = createBin({ name: "A" });
    assignNoteToBin({ note_id: note.id, bin_id: a.id, assigned_by: "manual" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ from_bin_id: a.id, to_bin_id: "missing" }) });
    const res = await POST(req, { params: { id: note.id } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/app/api/bins/move-note.test.ts`

Expected: FAIL — module not found error for `app/api/notes/[id]/move/route.ts`.

- [ ] **Step 3: Create the route handler**

Create `app/api/notes/[id]/move/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getBinById, moveNoteBetweenBins } from "@/lib/queries/bins";
import { badRequest, isNonEmptyString, readJson } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson(req);
  if (!body || typeof body !== "object") return badRequest("invalid json body");
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.from_bin_id, 32)) return badRequest("from_bin_id required");
  if (!isNonEmptyString(b.to_bin_id, 32)) return badRequest("to_bin_id required");

  const from = getBinById(b.from_bin_id as string);
  const to = getBinById(b.to_bin_id as string);
  if (!from || !to) return NextResponse.json({ error: "bin not found" }, { status: 404 });

  try {
    moveNoteBetweenBins(params.id, b.from_bin_id as string, b.to_bin_id as string);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "move failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/api/bins/move-note.test.ts`

Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add app/api/notes/[id]/move/route.ts tests/app/api/bins/move-note.test.ts
git commit -m "feat(api): POST /api/notes/[id]/move atomic move endpoint"
```

---

## Task 8: API endpoint GET /api/bins/[id]/preview-delete

**Files:**
- Create: `app/api/bins/[id]/preview-delete/route.ts`
- Test: `tests/app/api/bins/preview-delete.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/api/bins/preview-delete.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin } from "../../../../lib/queries/bins";
import { GET } from "../../../../app/api/bins/[id]/preview-delete/route";

const TEST_DB = path.join(process.cwd(), "data", "test-preview-delete.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("GET /api/bins/[id]/preview-delete", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns counts for a bin with children", async () => {
    const root = createBin({ name: "Root" });
    createBin({ name: "alpha", parent_bin_id: root.id });
    createBin({ name: "bravo", parent_bin_id: root.id });
    const res = await GET(new Request("http://x"), { params: { id: root.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.child_bin_count).toBe(2);
    expect(body.child_bin_names).toEqual(["alpha", "bravo"]);
    expect(body.has_more_children).toBe(false);
    expect(body.note_count).toBe(0);
  });

  it("returns 404 for missing bin", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/app/api/bins/preview-delete.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the route handler**

Create `app/api/bins/[id]/preview-delete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getBinById, getBinDeletePreview } from "@/lib/queries/bins";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(getBinDeletePreview(params.id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/api/bins/preview-delete.test.ts`

Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add app/api/bins/[id]/preview-delete/route.ts tests/app/api/bins/preview-delete.test.ts
git commit -m "feat(api): GET /api/bins/[id]/preview-delete"
```

---

## Task 9: API endpoint GET /api/bins/[id]/preview-merge

**Files:**
- Create: `app/api/bins/[id]/preview-merge/route.ts`
- Test: `tests/app/api/bins/preview-merge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/api/bins/preview-merge.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, assignNoteToBin } from "../../../../lib/queries/bins";
import { upsertVaultNote } from "../../../../lib/queries/vault-notes";
import { nowIso } from "../../../../lib/utils";
import { GET } from "../../../../app/api/bins/[id]/preview-merge/route";

const TEST_DB = path.join(process.cwd(), "data", "test-preview-merge.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("GET /api/bins/[id]/preview-merge", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns direct child + note counts", async () => {
    const root = createBin({ name: "Root" });
    const child = createBin({ name: "Child", parent_bin_id: root.id });
    createBin({ name: "Grand", parent_bin_id: child.id });
    const note = upsertVaultNote({
      vault_path: "p.md", source: "obsidian",
      source_id: null, source_url: null,
      title: "T", content_hash: "h", modified_at: nowIso(),
    });
    assignNoteToBin({ note_id: note.id, bin_id: root.id, assigned_by: "manual" });
    const res = await GET(new Request("http://x"), { params: { id: root.id } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.direct_child_count).toBe(1); // Grand is NOT counted
    expect(body.direct_note_count).toBe(1);
  });

  it("returns 404 for missing bin", async () => {
    const res = await GET(new Request("http://x"), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/app/api/bins/preview-merge.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the route handler**

Create `app/api/bins/[id]/preview-merge/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getBinById, getBinMergePreview } from "@/lib/queries/bins";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(getBinMergePreview(params.id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/api/bins/preview-merge.test.ts`

Expected: PASS — both cases.

- [ ] **Step 5: Commit**

```bash
git add app/api/bins/[id]/preview-merge/route.ts tests/app/api/bins/preview-merge.test.ts
git commit -m "feat(api): GET /api/bins/[id]/preview-merge"
```

---

## Task 10: DELETE seeded-bin guard

**Files:**
- Modify: `app/api/bins/[id]/route.ts` (the DELETE handler)
- Test: `tests/app/api/bins/seeded-bin-protection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/api/bins/seeded-bin-protection.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, getBinById, getOrCreateBinBySeed } from "../../../../lib/queries/bins";
import { DELETE } from "../../../../app/api/bins/[id]/route";

const TEST_DB = path.join(process.cwd(), "data", "test-seeded-protect.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("DELETE /api/bins/[id] seeded-bin protection", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("returns 403 when deleting a seeded bin", async () => {
    const seeded = getOrCreateBinBySeed("notion-sync", "Notion sync");
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: seeded.id } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/seeded/i);
    expect(getBinById(seeded.id)).not.toBeNull(); // still exists
  });

  it("allows deletion of non-seeded bins (sanity)", async () => {
    const bin = createBin({ name: "Regular" });
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: bin.id } });
    expect(res.status).toBe(200);
    expect(getBinById(bin.id)).toBeNull();
  });

  it("returns 404 for missing bin", async () => {
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), { params: { id: "missing" } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify the seeded test fails**

Run: `npx vitest run tests/app/api/bins/seeded-bin-protection.test.ts`

Expected: FAIL — first test gets a 200 because the guard isn't in place yet (seeded bin gets deleted).

- [ ] **Step 3: Update DELETE handler in `app/api/bins/[id]/route.ts`**

Replace the existing DELETE handler with:

```ts
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const existing = getBinById(params.id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.source_seed) {
    return NextResponse.json({ error: "seeded bins cannot be deleted" }, { status: 403 });
  }
  deleteBin(params.id);
  return NextResponse.json({ ok: true });
}
```

(Imports already include `getBinById` and `deleteBin` — no new imports needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/api/bins/seeded-bin-protection.test.ts`

Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add app/api/bins/[id]/route.ts tests/app/api/bins/seeded-bin-protection.test.ts
git commit -m "feat(api): DELETE /api/bins/[id] returns 403 for seeded bins"
```

---

## Task 11: PATCH cycle validation for parent_bin_id

**Files:**
- Modify: `app/api/bins/[id]/route.ts` (PATCH handler)
- Test: `tests/app/api/bins/cycle-validation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/app/api/bins/cycle-validation.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { resetDbForTesting, closeDb } from "../../../../lib/db";
import { createBin, getBinById } from "../../../../lib/queries/bins";
import { PATCH } from "../../../../app/api/bins/[id]/route";

const TEST_DB = path.join(process.cwd(), "data", "test-cycle.db");

function initTestDb() {
  const db = resetDbForTesting(TEST_DB);
  const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf-8");
  db.exec(schema);
}

describe("PATCH /api/bins/[id] cycle validation", () => {
  beforeEach(() => initTestDb());
  afterEach(() => {
    closeDb();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it("rejects setting parent to self with 400", async () => {
    const a = createBin({ name: "A" });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ parent_bin_id: a.id }) });
    const res = await PATCH(req, { params: { id: a.id } });
    expect(res.status).toBe(400);
    expect(getBinById(a.id)?.parent_bin_id).toBeNull();
  });

  it("rejects setting parent to a descendant with 400", async () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B", parent_bin_id: a.id });
    const c = createBin({ name: "C", parent_bin_id: b.id });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ parent_bin_id: c.id }) });
    const res = await PATCH(req, { params: { id: a.id } });
    expect(res.status).toBe(400);
  });

  it("allows setting parent to an unrelated bin", async () => {
    const a = createBin({ name: "A" });
    const b = createBin({ name: "B" });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ parent_bin_id: b.id }) });
    const res = await PATCH(req, { params: { id: a.id } });
    expect(res.status).toBe(200);
    expect(getBinById(a.id)?.parent_bin_id).toBe(b.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/app/api/bins/cycle-validation.test.ts`

Expected: FAIL — first two tests succeed (no cycle check yet).

- [ ] **Step 3: Update PATCH handler in `app/api/bins/[id]/route.ts`**

Add the import:
```ts
import { getBinById, updateBin, deleteBin, mergeBin, isDescendantOf } from "@/lib/queries/bins";
```

Inside PATCH, after the `b.sort_order` validation and before the `updateBin` call, add:

```ts
  // Cycle prevention for parent_bin_id changes
  if (typeof b.parent_bin_id === "string") {
    if (b.parent_bin_id === params.id) return badRequest("bin cannot be its own parent");
    if (isDescendantOf(b.parent_bin_id, params.id)) {
      return badRequest("bin cannot be a child of its own descendant");
    }
  }
```

(`isDescendantOf(maybeChild, ancestor)` — call args mean "is `b.parent_bin_id` a descendant of `params.id`?")

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/app/api/bins/cycle-validation.test.ts`

Expected: PASS — all 3 cases.

- [ ] **Step 5: Run the merge-children regression test as a sanity check**

Run: `npx vitest run tests/lib/queries/bins.test.ts -t "mergeBin"` and `npx vitest run tests/app/api/bins/`

Expected: PASS — all bin tests still green.

- [ ] **Step 6: Commit**

```bash
git add app/api/bins/[id]/route.ts tests/app/api/bins/cycle-validation.test.ts
git commit -m "feat(api): PATCH /api/bins/[id] rejects parent cycles"
```

---

## Task 12: Add `PlusIcon` to `components/icons.tsx`

**Files:**
- Modify: `components/icons.tsx`

- [ ] **Step 1: Add the icon**

Append to `components/icons.tsx` (use the existing `makeIcon` helper pattern):

```tsx
export const PlusIcon = makeIcon("Plus", <path d="M12 5v14M5 12h14" />);
```

- [ ] **Step 2: Verify build still passes**

Run: `npm run build` (or `npx tsc --noEmit` for a quicker check)

Expected: clean — no type errors.

- [ ] **Step 3: Commit**

```bash
git add components/icons.tsx
git commit -m "feat(icons): add PlusIcon"
```

---

## Task 13: `<Modal>` component with focus trap

**Files:**
- Create: `components/Modal.tsx`

No automated tests — vitest is configured for `node` env, not jsdom. Verified manually in Task 25 smoke test.

- [ ] **Step 1: Create the Modal component**

Create `components/Modal.tsx`:

```tsx
"use client";

import { useEffect, useRef, useId, ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function Modal({ open, onClose, title, size = "md", children }: ModalProps) {
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    const focusables = containerRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    focusables?.[0]?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const list = containerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!list || list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-md flex items-center justify-center"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${sizeClasses[size]} bg-raised border border-border-default rounded-lg shadow-xl p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="font-mono uppercase tracking-wide text-xs text-text-secondary mb-3">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-2 mt-4">{children}</div>;
}
```

- [ ] **Step 2: Run build to verify**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/Modal.tsx
git commit -m "feat(ui): add Modal component with focus trap"
```

---

## Task 14: `<ContextMenu>` component + provider hook

**Files:**
- Create: `components/ContextMenu.tsx`

No automated tests — manual verification in Task 25.

- [ ] **Step 1: Create the ContextMenu component**

Create `components/ContextMenu.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode, MouseEvent } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface OpenState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuContextValue {
  open(e: MouseEvent | { clientX: number; clientY: number; preventDefault: () => void }, items: ContextMenuItem[]): void;
  close(): void;
}

const Ctx = createContext<ContextMenuContextValue | null>(null);

export function useContextMenu(): ContextMenuContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useContextMenu must be inside <ContextMenuProvider>");
  return v;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function open(
    e: MouseEvent | { clientX: number; clientY: number; preventDefault: () => void },
    items: ContextMenuItem[]
  ) {
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items });
  }

  function close() {
    setState(null);
  }

  useEffect(() => {
    if (!state) return;
    function onDocClick(ev: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) close();
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [state]);

  // Position clamp: shift left/up if menu would overflow viewport
  const root = typeof document !== "undefined" ? document.getElementById("context-menu-root") : null;
  const menu = state && root ? (
    <div
      ref={menuRef}
      style={{ left: clampX(state.x), top: clampY(state.y) }}
      className="fixed z-[80] min-w-[160px] bg-raised border border-border-default rounded-md shadow-xl py-1"
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.action();
            close();
          }}
          className={[
            "w-full text-left px-3 py-1.5 font-mono uppercase tracking-wide text-xs",
            item.disabled
              ? "text-text-tertiary cursor-not-allowed"
              : item.danger
              ? "text-red-400 hover:bg-red-500/10"
              : "text-text-primary hover:bg-base",
          ].join(" ")}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {menu && root ? createPortal(menu, root) : null}
    </Ctx.Provider>
  );
}

function clampX(x: number) {
  if (typeof window === "undefined") return x;
  const menuWidth = 200;
  return Math.min(x, window.innerWidth - menuWidth - 8);
}
function clampY(y: number) {
  if (typeof window === "undefined") return y;
  const menuHeightEstimate = 220;
  return Math.min(y, window.innerHeight - menuHeightEstimate - 8);
}
```

- [ ] **Step 2: Run build to verify**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/ContextMenu.tsx
git commit -m "feat(ui): add ContextMenu component + provider"
```

---

## Task 15: Hoist `<ToastProvider>` to layout + mount context-menu-root

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx` (remove the now-redundant ToastProvider wrapper)

- [ ] **Step 1: Update `app/layout.tsx`**

Replace the file with:

```tsx
"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { GlobalCapture } from "@/components/GlobalCapture";
import { ToastProvider } from "@/components/chat/ToastProvider";
import { ContextMenuProvider } from "@/components/ContextMenu";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);

  return (
    <html lang="en">
      <head>
        <title>Command Center</title>
      </head>
      <body>
        <ToastProvider>
          <ContextMenuProvider>
            <Sidebar selectedBinId={selectedBinId} onSelectBin={setSelectedBinId} />
            <GlobalCapture />
            <main className="ml-[220px] min-h-screen bg-base" data-selected-bin={selectedBinId ?? ""}>
              {children}
            </main>
            <div id="context-menu-root" />
          </ContextMenuProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Update `app/page.tsx` to remove the redundant ToastProvider wrapper**

Find the bottom of `app/page.tsx` and replace the wrapper export. Locate this block (around lines 219-225):

```tsx
export default function ChatPage() {
  return (
    <ToastProvider>
      <ChatPageInner />
    </ToastProvider>
  );
}
```

Replace with:

```tsx
export default function ChatPage() {
  return <ChatPageInner />;
}
```

Then remove the now-unused import at the top of the file:

```tsx
import { ToastProvider, useToast } from "@/components/chat/ToastProvider";
```

becomes:

```tsx
import { useToast } from "@/components/chat/ToastProvider";
```

- [ ] **Step 3: Run build and tests to verify**

Run: `npx tsc --noEmit && npm test`

Expected: clean type-check, all tests still pass.

- [ ] **Step 4: Manually verify chat page still works**

Run: `VAULT_PATH=$HOME/Vault PORT=3001 npm run dev`

Open http://localhost:3001 — chat should still load and toasts should still appear if you trigger an error (e.g., unset profile).

Then kill the dev server.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx app/page.tsx
git commit -m "feat(ui): hoist ToastProvider to layout, mount ContextMenuProvider + portal root"
```

---

## Task 16: `<CreateBinModal>` component

**Files:**
- Create: `components/CreateBinModal.tsx`

- [ ] **Step 1: Create the component**

Create `components/CreateBinModal.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { Modal, ModalFooter } from "./Modal";
import { useToast } from "./chat/ToastProvider";

interface CreateBinModalProps {
  open: boolean;
  parentBinId: string | null;
  parentBinName?: string | null; // optional, for header context
  onClose(): void;
  onCreated(newBinId: string): void;
}

export function CreateBinModal({ open, parentBinId, parentBinName, onClose, onCreated }: CreateBinModalProps) {
  const { show } = useToast();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const trimmed = name.trim();
  const tooLong = trimmed.length > 120;
  const valid = trimmed.length > 0 && !tooLong;
  const title = parentBinName ? `New child bin in "${parentBinName}"` : "New bin";

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/bins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, parent_bin_id: parentBinId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Create failed (${res.status})`);
      }
      const data = await res.json();
      show(`Created '${trimmed}'`, "info");
      onCreated(data.bin.id);
      onClose();
    } catch (e) {
      show(e instanceof Error ? e.message : "Create failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && valid) handleSubmit(); }}
        placeholder="Bin name"
        className="w-full px-3 py-2 bg-base border border-border-default rounded text-text-primary outline-none focus:border-accent"
      />
      {tooLong && (
        <div className="mt-2 text-xs text-red-400">Too long — max 120 characters</div>
      )}
      <ModalFooter>
        <button
          onClick={onClose}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          disabled={!valid || submitting}
          onClick={handleSubmit}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs bg-accent text-base rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Creating…" : "Create"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/CreateBinModal.tsx
git commit -m "feat(ui): add CreateBinModal"
```

---

## Task 17: `<BinPicker>` modal

**Files:**
- Create: `components/BinPicker.tsx`

- [ ] **Step 1: Create the component**

Create `components/BinPicker.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Modal, ModalFooter } from "./Modal";
import { BinTree } from "./BinTree";
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
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/BinPicker.tsx
git commit -m "feat(ui): add BinPicker modal with filter, exclude, and already-in handling"
```

---

## Task 18: `<DeleteBinModal>` component

**Files:**
- Create: `components/DeleteBinModal.tsx`

- [ ] **Step 1: Create the component**

Create `components/DeleteBinModal.tsx`:

```tsx
"use client";

import { useEffect, useState, useRef } from "react";
import { Modal, ModalFooter } from "./Modal";
import { useToast } from "./chat/ToastProvider";

interface Preview {
  child_bin_count: number;
  child_bin_names: string[];
  has_more_children: boolean;
  note_count: number;
}

interface DeleteBinModalProps {
  open: boolean;
  binId: string | null;
  binName: string;
  onClose(): void;
  onDeleted(): void;
}

export function DeleteBinModal({ open, binId, binName, onClose, onDeleted }: DeleteBinModalProps) {
  const { show } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !binId) return;
    setPreview(null);
    fetch(`/api/bins/${binId}/preview-delete`)
      .then((r) => r.json())
      .then((d) => setPreview(d))
      .catch(() => setPreview({ child_bin_count: 0, child_bin_names: [], has_more_children: false, note_count: 0 }));
  }, [open, binId]);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open, preview]);

  async function handleDelete() {
    if (!binId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bins/${binId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Delete failed (${res.status})`);
      }
      const childWord = preview && preview.child_bin_count > 0
        ? ` and ${preview.child_bin_count} sub-bin${preview.child_bin_count === 1 ? "" : "s"}`
        : "";
      show(`Deleted '${binName}'${childWord}`, "info");
      onDeleted();
      onClose();
    } catch (e) {
      show(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const isEmpty = preview && preview.child_bin_count === 0 && preview.note_count === 0;
  const namesLine = preview && preview.child_bin_names.length > 0
    ? ` (${preview.child_bin_names.join(", ")}${preview.has_more_children ? ", …and more" : ""})`
    : "";

  return (
    <Modal open={open} onClose={onClose} title={`Delete bin "${binName}"?`} size="md">
      {!preview ? (
        <div className="text-xs text-text-tertiary">Loading preview…</div>
      ) : isEmpty ? (
        <div className="text-sm text-text-secondary">This bin is empty. Delete it?</div>
      ) : (
        <div className="text-sm text-text-secondary space-y-2">
          <div>This will:</div>
          <ul className="list-disc list-inside space-y-1">
            {preview.child_bin_count > 0 && (
              <li>Delete {preview.child_bin_count} sub-bin{preview.child_bin_count === 1 ? "" : "s"}{namesLine}</li>
            )}
            {preview.note_count > 0 && (
              <li>Unassign {preview.note_count} note{preview.note_count === 1 ? "" : "s"} (notes themselves stay in vault)</li>
            )}
          </ul>
          <div className="pt-2 text-xs text-text-tertiary">This cannot be undone.</div>
        </div>
      )}
      <ModalFooter>
        <button
          ref={cancelRef}
          onClick={onClose}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          disabled={submitting || !preview}
          onClick={handleDelete}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 disabled:opacity-50"
        >
          {submitting ? "Deleting…" : "Delete"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/DeleteBinModal.tsx
git commit -m "feat(ui): add DeleteBinModal with blast-radius preview"
```

---

## Task 19: `<MergeBinModal>` component

**Files:**
- Create: `components/MergeBinModal.tsx`

- [ ] **Step 1: Create the component**

Create `components/MergeBinModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Modal, ModalFooter } from "./Modal";
import { useToast } from "./chat/ToastProvider";

interface Preview {
  direct_child_count: number;
  direct_note_count: number;
}

interface MergeBinModalProps {
  open: boolean;
  sourceId: string | null;
  sourceName: string;
  targetId: string | null;
  targetName: string;
  onClose(): void;
  onMerged(targetId: string): void;
}

export function MergeBinModal({
  open, sourceId, sourceName, targetId, targetName, onClose, onMerged,
}: MergeBinModalProps) {
  const { show } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !sourceId) return;
    setPreview(null);
    fetch(`/api/bins/${sourceId}/preview-merge`)
      .then((r) => r.json())
      .then((d) => setPreview(d))
      .catch(() => setPreview({ direct_child_count: 0, direct_note_count: 0 }));
  }, [open, sourceId]);

  async function handleMerge() {
    if (!sourceId || !targetId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bins/${sourceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merge_into: targetId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Merge failed (${res.status})`);
      }
      show(`Merged '${sourceName}' into '${targetName}'`, "info");
      onMerged(targetId);
      onClose();
    } catch (e) {
      show(e instanceof Error ? e.message : "Merge failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Merge "${sourceName}" into "${targetName}"?`} size="md">
      {!preview ? (
        <div className="text-xs text-text-tertiary">Loading preview…</div>
      ) : (
        <div className="text-sm text-text-secondary space-y-2">
          <div>This will:</div>
          <ul className="list-disc list-inside space-y-1">
            <li>
              Move {preview.direct_note_count} note{preview.direct_note_count === 1 ? "" : "s"} from "{sourceName}" to "{targetName}"
            </li>
            <li>Delete the empty "{sourceName}" bin</li>
          </ul>
          {preview.direct_child_count > 0 && (
            <div className="pt-2 text-xs text-yellow-400">
              ⚠ Sub-bins of "{sourceName}" ({preview.direct_child_count}) will be re-parented to "{targetName}".
            </div>
          )}
          <div className="pt-2 text-xs text-text-tertiary">This cannot be undone.</div>
        </div>
      )}
      <ModalFooter>
        <button onClick={onClose} className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs text-text-secondary hover:text-text-primary">
          Cancel
        </button>
        <button
          disabled={submitting || !preview}
          onClick={handleMerge}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs bg-accent text-base rounded disabled:opacity-50"
        >
          {submitting ? "Merging…" : "Merge"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
```

- [ ] **Step 2: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/MergeBinModal.tsx
git commit -m "feat(ui): add MergeBinModal with preview"
```

---

## Task 20: `lib/dnd.ts` — useDrag/useDrop hooks

**Files:**
- Create: `lib/dnd.ts`

This task includes both the hooks AND the drag-preview helper (spec §5.5) and modifier hint pill (spec §5.6).

- [ ] **Step 1: Create the DnD hook layer (with drag preview helper)**

Create `lib/dnd.ts`:

```ts
"use client";

import { useEffect, useRef, useState, useCallback, DragEvent as ReactDragEvent } from "react";

export type DragKind = "note" | "bin";

export interface DragPayload {
  kind: DragKind;
  id: string;
  /** Optional context bin id (for notes — the bin currently displayed). */
  contextBinId?: string | null;
}

const MIME = "application/x-dashboard";

/**
 * Tracks whether ⌘/Ctrl is currently held while a drag is active.
 * Returns a function to call before reading state in a drop handler.
 */
export function useIsCommandHeld(): { current: boolean } {
  const ref = useRef(false);
  useEffect(() => {
    function down(e: KeyboardEvent) { if (e.metaKey || e.ctrlKey) ref.current = true; }
    function up(e: KeyboardEvent) { if (!e.metaKey && !e.ctrlKey) ref.current = false; }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => { ref.current = false; });
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return ref;
}

/**
 * Returns props to spread onto a draggable element.
 * Generates a faded clone of the source for the drag preview (spec §5.5).
 */
export function useDrag(payload: DragPayload | (() => DragPayload)) {
  return {
    draggable: true,
    onDragStart: (e: ReactDragEvent) => {
      const data = typeof payload === "function" ? payload() : payload;
      e.dataTransfer.setData(MIME, JSON.stringify(data));
      e.dataTransfer.effectAllowed = "copyMove";
      // Drag preview: clone the source element, scale to 80%, opacity 70%
      const src = e.currentTarget as HTMLElement;
      const clone = src.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.top = "-1000px";
      clone.style.transform = "scale(0.8)";
      clone.style.opacity = "0.7";
      clone.style.pointerEvents = "none";
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, 10, 10);
      // Clean up the clone after the browser captures the image
      setTimeout(() => clone.remove(), 0);
    },
  };
}

interface UseDropOptions {
  /** Decide if a drop with given payload should be accepted. */
  accept(payload: DragPayload): boolean;
  /** Called on drop. */
  onDrop(payload: DragPayload, e: ReactDragEvent): void;
}

// HTML5 drag-and-drop limitation: dataTransfer.getData() returns "" during dragover
// and dragenter in most browsers (data is only readable on the actual drop event).
// Our useDrop accept() runs against the cached payload when available; when not,
// the hover indicator falls back to "valid" and the actual validation happens
// at drop time (server returns 400 if invalid → toast surfaces error).
// This means visual indicators for invalid drops (e.g., dragging a parent onto
// its own child) may show cyan instead of red dashed during hover. Not a blocker
// for v1.2.1 — server-side cycle validation (Task 11) catches it on drop.

/**
 * Returns props + state for a drop target. State indicates whether a valid drag is hovering it.
 */
export function useDrop({ accept, onDrop }: UseDropOptions) {
  const [hover, setHover] = useState<"none" | "valid" | "invalid">("none");

  const onDragOver = useCallback((e: ReactDragEvent) => {
    const raw = e.dataTransfer.getData(MIME);
    if (!raw) {
      // Some browsers don't expose data during dragover — be permissive
      e.preventDefault();
      return;
    }
    let payload: DragPayload | null = null;
    try { payload = JSON.parse(raw) as DragPayload; } catch { /* ignore */ }
    if (!payload) return;
    if (accept(payload)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, [accept]);

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    const raw = e.dataTransfer.getData(MIME);
    let payload: DragPayload | null = null;
    if (raw) { try { payload = JSON.parse(raw) as DragPayload; } catch { /* ignore */ } }
    if (!payload) {
      // Show valid as default during enter (data may be unavailable until drop in some browsers)
      setHover("valid");
      return;
    }
    setHover(accept(payload) ? "valid" : "invalid");
  }, [accept]);

  const onDragLeave = useCallback(() => { setHover("none"); }, []);

  const onDropFn = useCallback((e: ReactDragEvent) => {
    setHover("none");
    const raw = e.dataTransfer.getData(MIME);
    if (!raw) return;
    let payload: DragPayload | null = null;
    try { payload = JSON.parse(raw) as DragPayload; } catch { return; }
    if (!payload || !accept(payload)) return;
    e.preventDefault();
    onDrop(payload, e);
  }, [accept, onDrop]);

  return {
    hover,
    dropProps: { onDragOver, onDragEnter, onDragLeave, onDrop: onDropFn },
  };
}

export function parseDragPayload(e: ReactDragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(MIME);
  if (!raw) return null;
  try { return JSON.parse(raw) as DragPayload; } catch { return null; }
}

/**
 * Tracks whether ANY drag is currently in progress at the document level.
 * Used by the modifier hint pill (spec §5.6) to know when to render.
 */
export function useIsDragging(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    function onStart() { setDragging(true); }
    function onEnd() { setDragging(false); }
    document.addEventListener("dragstart", onStart);
    document.addEventListener("dragend", onEnd);
    document.addEventListener("drop", onEnd);
    return () => {
      document.removeEventListener("dragstart", onStart);
      document.removeEventListener("dragend", onEnd);
      document.removeEventListener("drop", onEnd);
    };
  }, []);
  return dragging;
}
```

- [ ] **Step 2: Create the modifier hint pill component**

Create `components/DragModifierHint.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useIsDragging } from "@/lib/dnd";

export function DragModifierHint() {
  const dragging = useIsDragging();
  const [cmd, setCmd] = useState(false);

  useEffect(() => {
    if (!dragging) { setCmd(false); return; }
    function down(e: KeyboardEvent) { if (e.metaKey || e.ctrlKey) setCmd(true); }
    function up(e: KeyboardEvent) { if (!e.metaKey && !e.ctrlKey) setCmd(false); }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [dragging]);

  if (!dragging) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[75] font-mono text-xs px-2 py-1 bg-raised border border-border-default rounded-md text-text-secondary pointer-events-none">
      {cmd ? "Move (⌘)" : "Add"}
    </div>
  );
}
```

Mount it in `app/layout.tsx` next to ContextMenuProvider:

```tsx
import { DragModifierHint } from "@/components/DragModifierHint";

// inside the body, after <main>:
<DragModifierHint />
<div id="context-menu-root" />
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/dnd.ts components/DragModifierHint.tsx app/layout.tsx
git commit -m "feat(dnd): add useDrag/useDrop hooks, drag preview, modifier hint pill"
```

---

## Task 21: Sidebar `+ new bin` button

**Files:**
- Modify: `components/Sidebar.tsx`

- [ ] **Step 1: Update Sidebar to show + new bin button and host CreateBinModal**

Read the existing `components/Sidebar.tsx`. Locate the search-input row at the top of the bin tree section (before `<BinTree …/>`).

Add at the top of `Sidebar.tsx` imports:

```tsx
import { useState } from "react";
import { CreateBinModal } from "./CreateBinModal";
import { PlusIcon } from "./icons";
```

Add inside the `Sidebar` function body (top, with other state):

```tsx
const [createOpen, setCreateOpen] = useState(false);
const [createParent, setCreateParent] = useState<{ id: string | null; name?: string }>({ id: null });
const [refreshKey, setRefreshKey] = useState(0);
```

Find the existing bin-fetch effect and add `refreshKey` as a dependency so it re-fetches after a create:

```tsx
useEffect(() => {
  fetch("/api/bins").then((r) => r.json()).then((d) => setBins(d.bins ?? []));
}, [refreshKey]);
```

Modify the search input row — wrap it so the input is on the left and the `+` button on the right:

```tsx
<div className="px-3 mb-2 flex items-center gap-2">
  <input
    value={filter}
    onChange={(e) => setFilter(e.target.value)}
    placeholder="Filter bins…"
    className="flex-1 px-2 py-1 text-xs bg-base border border-border-default rounded text-text-primary outline-none focus:border-accent"
  />
  <button
    onClick={() => { setCreateParent({ id: null }); setCreateOpen(true); }}
    title="New bin"
    aria-label="New bin"
    className="p-1 text-text-secondary hover:text-accent"
  >
    <PlusIcon size={14} />
  </button>
</div>
```

(Match the existing styling — adjust class names if Sidebar uses different padding/spacing classes. The structure is what matters.)

At the bottom of the JSX returned by Sidebar (just before the closing tag), add:

```tsx
<CreateBinModal
  open={createOpen}
  parentBinId={createParent.id}
  parentBinName={createParent.name ?? null}
  onClose={() => setCreateOpen(false)}
  onCreated={(newId) => {
    setRefreshKey((k) => k + 1);
    onSelectBin(newId);
  }}
/>
```

(If "New child bin" needs to launch CreateBinModal from within BinTree, expose a callback prop in Task 22. For now just the top-level + button.)

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 3: Manual smoke (briefly)**

Run: `VAULT_PATH=$HOME/Vault PORT=3001 npm run dev`

Open http://localhost:3001. Click `+` next to bin filter. Modal opens. Type "test bin", press Enter. Modal closes. New bin appears in sidebar. Toast appears. Kill dev server.

- [ ] **Step 4: Commit**

```bash
git add components/Sidebar.tsx
git commit -m "feat(sidebar): add '+ new bin' button and CreateBinModal integration"
```

---

## Task 22: BinTree context menu + inline rename + child-bin creation hook

**Files:**
- Modify: `components/BinTree.tsx`
- Modify: `components/Sidebar.tsx` (add a callback prop for "New child bin" launch)

- [ ] **Step 1: Add an `onRequestNewChild` prop to BinTree**

In `components/BinTree.tsx`, extend the props interface:

```tsx
interface BinTreeProps {
  bins: BinNode[];
  selectedBinId: string | null;
  onSelect(binId: string | null): void;
  filterQuery?: string;
  onRefresh?: () => void;                    // re-fetch after a mutation
  onRequestNewChild?: (parent: BinNode) => void; // open CreateBinModal with parent_bin_id
  onRequestMoveBin?: (bin: BinNode) => void;     // open BinPicker for re-parent
  onRequestMerge?: (bin: BinNode) => void;       // open BinPicker for merge
  onRequestDelete?: (bin: BinNode) => void;      // open DeleteBinModal
}
```

Pass these new optional props through to `<BinRow>` recursively — they're forwarded unchanged.

- [ ] **Step 2: Add inline rename state to BinRow**

Inside the `BinRow` component, add:

```tsx
const [editing, setEditing] = useState(false);
const [editValue, setEditValue] = useState(node.name);
const [editError, setEditError] = useState<string | null>(null);
const inputRef = useRef<HTMLInputElement | null>(null);

useEffect(() => {
  if (editing && inputRef.current) {
    inputRef.current.focus();
    inputRef.current.select();
  }
}, [editing]);

async function commitRename() {
  const trimmed = editValue.trim();
  if (!trimmed || trimmed.length > 120) {
    setEditError(!trimmed ? "Name required" : "Too long");
    return;
  }
  if (trimmed === node.name) { setEditing(false); return; }
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
```

(Imports: `useState`, `useEffect`, `useRef` from "react".)

- [ ] **Step 3: Add right-click handler with the menu items**

In `BinRow`, add the `useContextMenu` hook and wire `onContextMenu` on the row:

```tsx
import { useContextMenu } from "./ContextMenu";
const menu = useContextMenu();
```

Build the items list and attach to the row container:

```tsx
function handleContextMenu(e: React.MouseEvent) {
  const items = [
    { label: "New child bin", action: () => onRequestNewChild?.(node) },
    { label: "Rename", action: () => { setEditValue(node.name); setEditing(true); setEditError(null); } },
    { label: "Move bin…", action: () => onRequestMoveBin?.(node) },
    { label: "Merge into…", action: () => onRequestMerge?.(node) },
  ];
  if (!node.source_seed) {
    items.push({ label: "Delete", action: () => onRequestDelete?.(node), danger: true });
  }
  menu.open(e, items);
}
```

Spread `onContextMenu={handleContextMenu}` onto the row's outermost interactive element (the existing `<div>` or `<button>` — whichever wraps the bin name).

- [ ] **Step 4: Render the inline input when editing**

Replace the `<span>{node.name}</span>` (or equivalent name span) with:

```tsx
{editing ? (
  <input
    ref={inputRef}
    value={editValue}
    onChange={(e) => setEditValue(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === "Escape") { setEditing(false); setEditError(null); }
      else if (e.key === "Enter") commitRename();
    }}
    onBlur={commitRename}
    className="bg-base border border-border-default rounded px-1 text-xs font-mono uppercase tracking-wide text-text-primary outline-none focus:border-accent"
  />
) : (
  <span className="font-mono uppercase tracking-wide text-xs">{node.name}</span>
)}
{editError && <div className="text-xs text-red-400 ml-2">{editError}</div>}
```

- [ ] **Step 5: Wire up handlers in Sidebar**

In `components/Sidebar.tsx`, add state for the new modals:

```tsx
import { BinPicker } from "./BinPicker";
import { DeleteBinModal } from "./DeleteBinModal";
import { MergeBinModal } from "./MergeBinModal";
import { useToast } from "./chat/ToastProvider";

// inside Sidebar:
const toast = useToast();
const [moveBin, setMoveBin] = useState<BinNode | null>(null);
const [mergeBinSource, setMergeBinSource] = useState<BinNode | null>(null);
const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
const [mergeTargetName, setMergeTargetName] = useState<string>("");
const [mergePickerOpen, setMergePickerOpen] = useState(false);
const [deleteBin, setDeleteBin] = useState<BinNode | null>(null);
```

Pass new props into `<BinTree>`:

```tsx
<BinTree
  bins={bins}
  selectedBinId={selectedBinId}
  onSelect={onSelectBin}
  filterQuery={filter}
  onRefresh={() => setRefreshKey((k) => k + 1)}
  onRequestNewChild={(parent) => { setCreateParent({ id: parent.id, name: parent.name }); setCreateOpen(true); }}
  onRequestMoveBin={(bin) => setMoveBin(bin)}
  onRequestMerge={(bin) => { setMergeBinSource(bin); setMergePickerOpen(true); }}
  onRequestDelete={(bin) => setDeleteBin(bin)}
/>
```

Add the new modals just below the existing `<CreateBinModal>`:

```tsx
{moveBin && (
  <BinPicker
    open={!!moveBin}
    onClose={() => setMoveBin(null)}
    title={`Move "${moveBin.name}" to…`}
    excludeIds={[moveBin.id]}
    showTopLevelOption
    onPick={async (targetId) => {
      try {
        const res = await fetch(`/api/bins/${moveBin.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parent_bin_id: targetId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `Move failed (${res.status})`);
        }
        toast.show(`Moved '${moveBin.name}'`, "info");
        setRefreshKey((k) => k + 1);
      } catch (e) {
        toast.show(e instanceof Error ? e.message : "Move failed", "error");
      }
    }}
  />
)}

{mergeBinSource && (
  <BinPicker
    open={mergePickerOpen}
    onClose={() => { setMergePickerOpen(false); setMergeBinSource(null); }}
    title={`Merge "${mergeBinSource.name}" into…`}
    excludeIds={[mergeBinSource.id]}
    onPick={(targetId) => {
      if (!targetId) return;
      const target = findBinInTree(bins, targetId);
      setMergeTargetId(targetId);
      setMergeTargetName(target?.name ?? "?");
      setMergePickerOpen(false);
    }}
  />
)}

{mergeBinSource && mergeTargetId && (
  <MergeBinModal
    open={!!mergeTargetId}
    sourceId={mergeBinSource.id}
    sourceName={mergeBinSource.name}
    targetId={mergeTargetId}
    targetName={mergeTargetName}
    onClose={() => { setMergeTargetId(null); setMergeBinSource(null); }}
    onMerged={(targetId) => {
      onSelectBin(targetId);
      setRefreshKey((k) => k + 1);
    }}
  />
)}

<DeleteBinModal
  open={!!deleteBin}
  binId={deleteBin?.id ?? null}
  binName={deleteBin?.name ?? ""}
  onClose={() => setDeleteBin(null)}
  onDeleted={() => {
    if (deleteBin && selectedBinId === deleteBin.id) onSelectBin(null);
    setRefreshKey((k) => k + 1);
  }}
/>
```

Add a small helper at the bottom of `Sidebar.tsx`:

```tsx
function findBinInTree(bins: BinNode[], id: string): BinNode | null {
  for (const b of bins) {
    if (b.id === id) return b;
    const c = b.children ? findBinInTree(b.children, id) : null;
    if (c) return c;
  }
  return null;
}
```

- [ ] **Step 6: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 7: Manual smoke**

Run: `VAULT_PATH=$HOME/Vault PORT=3001 npm run dev`

Test sequence:
1. Right-click a bin → menu opens
2. Click "Rename" → bin name becomes input → type new name → Enter → commits
3. Right-click → "New child bin" → modal opens with parent context → create
4. Right-click → "Move bin…" → picker opens → select target → confirm → bin moves
5. Right-click → "Merge into…" → picker → confirm → MergeBinModal opens → confirm → source bin gone
6. Right-click → "Delete" → DeleteBinModal opens → confirm → bin gone
7. Right-click `notion-sync` (if present) → no Delete option

Kill dev server.

- [ ] **Step 8: Commit**

```bash
git add components/Sidebar.tsx components/BinTree.tsx
git commit -m "feat(sidebar): bin context menu, inline rename, move/merge/delete modals"
```

---

## Task 23: BinTree drag-and-drop (re-parent + reorder + drop indicators)

**Files:**
- Modify: `components/BinTree.tsx`

- [ ] **Step 1: Make bin rows draggable**

In `BinRow`, import the DnD hooks:

```tsx
import { useDrag, useDrop, useIsCommandHeld, parseDragPayload } from "@/lib/dnd";
```

Mark each row as draggable. At the row's outermost element, add the drag props:

```tsx
const dragProps = useDrag({ kind: "bin", id: node.id });
// spread {...dragProps} on the row container
```

- [ ] **Step 2: Add drop targets to bin rows (re-parent)**

In `BinRow`:

```tsx
const { hover, dropProps } = useDrop({
  accept: (payload) => {
    if (payload.kind === "bin") return payload.id !== node.id; // can't drop on self
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
        if (res.ok) onRefresh?.();
        else if (res.status === 400) { /* will be handled by toast in Step 4 */ }
      } catch { /* ignore */ }
    } else if (payload.kind === "note") {
      // Notes drop covered in Task 24
    }
  },
});
```

Spread `dropProps` on the row container as well. Combine with `dragProps`. The hover state drives the visual indicator (Step 3).

- [ ] **Step 3: Drop indicator visuals**

Apply class names based on `hover`:

```tsx
const ringClass =
  hover === "valid" ? "ring-2 ring-accent" :
  hover === "invalid" ? "ring-2 ring-red-500 ring-dashed" :
  "";
```

Add `${ringClass}` to the row's className.

- [ ] **Step 4: Add hover-toast for invalid drops**

For now keep it simple: server returns 400 if cycle (Task 11 added that). The fetch should surface errors via toast — call `useToast()` at top of BinRow:

```tsx
import { useToast } from "./chat/ToastProvider";
const { show } = useToast();
```

Then in the onDrop catch (and on `!res.ok`):

```ts
const err = await res.json().catch(() => ({}));
show(err.error ?? `Re-parent failed (${res.status})`, "error");
```

- [ ] **Step 5: Reorder via drag — drop zones between siblings**

`BinTree` currently renders bins as `bins.map((b) => <BinRow key={b.id} node={b} ... />)`. Wrap that mapping so each row gets a drop strip above it, and add one final strip below the last row.

In `components/BinTree.tsx`, define the `DropStrip` helper at the bottom of the file (above the default export, if any):

```tsx
function DropStrip({
  parentId, beforeNode, prevNode, lastNode, onRefresh,
}: {
  parentId: string | null;
  beforeNode: BinNode | null;       // null = drop at end
  prevNode: BinNode | null;          // sibling immediately above this strip
  lastNode: BinNode | null;          // last sibling, used when beforeNode is null
  onRefresh?: () => void;
}) {
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
        if (res.ok) onRefresh?.();
      } catch { /* error toast handled by re-parent path; reorder rarely fails */ }
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

function computeNewSortOrder(
  prev: BinNode | null,
  before: BinNode | null,
  last: BinNode | null
): number {
  // Drop between `prev` (above strip) and `before` (below strip)
  if (prev && before) return ((prev.sort_order ?? 0) + (before.sort_order ?? 0)) / 2;
  // Drop at start (no prev, before=first)
  if (!prev && before) return (before.sort_order ?? 0) - 1000;
  // Drop at end (before=null, last is the last sibling)
  if (last) return (last.sort_order ?? 0) + 1000;
  // Empty list
  return 0;
}
```

Then update the sibling-render loop in `BinTree` (and inside `BinRow` for child siblings) — wherever `bins.map((b) => <BinRow .../>)` appears, replace with:

```tsx
{bins.map((b, i) => (
  <Fragment key={b.id}>
    <DropStrip
      parentId={parentBinId ?? null}
      beforeNode={b}
      prevNode={bins[i - 1] ?? null}
      lastNode={bins[bins.length - 1] ?? null}
      onRefresh={onRefresh}
    />
    <BinRow node={b} {...passthroughProps} />
  </Fragment>
))}
<DropStrip
  parentId={parentBinId ?? null}
  beforeNode={null}
  prevNode={bins[bins.length - 1] ?? null}
  lastNode={bins[bins.length - 1] ?? null}
  onRefresh={onRefresh}
/>
```

`parentBinId` here means: the parent of the sibling group being rendered. For the top-level call, `null`. For recursive calls inside `BinRow` rendering its own children, pass `node.id`. Add `import { Fragment } from "react";`

- [ ] **Step 6: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 7: Manual smoke**

Run dev server. Test:
1. Drag a bin onto another bin → it becomes a child
2. Drag a bin between two siblings → it re-orders
3. Drag a bin onto itself → red dashed ring, no action
4. Drag a parent bin onto its own child → hover may show valid (we don't deep-check client-side beyond self), but server returns 400 → error toast surfaces

Kill dev server.

- [ ] **Step 8: Commit**

```bash
git add components/BinTree.tsx
git commit -m "feat(sidebar): drag-and-drop re-parent + reorder + drop indicators"
```

---

## Task 24: NoteList context menu + multi-bin badge + drag source + drop targets in BinTree

**Files:**
- Modify: `components/NoteList.tsx`
- Modify: `components/BinTree.tsx` (the note-drop handling was stubbed in Task 23; flesh out here)

- [ ] **Step 1: Extend NoteList props**

In `components/NoteList.tsx` interface:

```tsx
interface NoteListProps {
  notes: VaultNote[];
  onNoteClick: (note: VaultNote) => void;
  emptyMessage?: string;
  selectedPath?: string | null;
  /** Bin currently displayed (null for Recent view). Used for context-menu Move and Remove visibility. */
  currentBinId?: string | null;
  /** Bin assignments per note (note_id → bin_ids). When undefined or note's bins is missing, multi-bin badge hidden. */
  noteBins?: Map<string, string[]>;
  /** Called after a successful in-modal mutation so the page can refresh its list. */
  onMutated?: () => void;
}
```

- [ ] **Step 2: Add right-click + drag attributes per row**

At the top of `NoteList.tsx`:

```tsx
import { useContextMenu } from "./ContextMenu";
import { useDrag } from "@/lib/dnd";
import { useToast } from "./chat/ToastProvider";
import { useState } from "react";
import { BinPicker } from "./BinPicker";
```

Inside the `NoteList` function:

```tsx
const menu = useContextMenu();
const { show } = useToast();
const [pickerOpen, setPickerOpen] = useState(false);
const [pickerMode, setPickerMode] = useState<"add" | "move">("add");
const [pickerNote, setPickerNote] = useState<VaultNote | null>(null);
```

Build per-note row context menu handler:

```tsx
function handleNoteContext(e: React.MouseEvent, note: VaultNote) {
  const noteBinIds = noteBins?.get(note.id) ?? [];
  const sourceUnambiguous = currentBinId !== null && currentBinId !== undefined
    ? true
    : noteBinIds.length === 1;

  const items = [
    { label: "Open", action: () => onNoteClick(note) },
    { label: "Add to bin…", action: () => { setPickerMode("add"); setPickerNote(note); setPickerOpen(true); } },
  ];
  if (sourceUnambiguous) {
    items.push({ label: "Move to bin…", action: () => { setPickerMode("move"); setPickerNote(note); setPickerOpen(true); } });
  }
  if (currentBinId) {
    items.push({
      label: "Remove from this bin",
      action: async () => {
        try {
          const res = await fetch(`/api/bins/${currentBinId}/assign/${note.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error(`Remove failed (${res.status})`);
          show(`Removed from bin`, "info");
          onMutated?.();
        } catch (err) {
          show(err instanceof Error ? err.message : "Remove failed", "error");
        }
      },
      danger: true,
    });
  }
  menu.open(e, items);
}
```

For each row, wrap with `onContextMenu` and `useDrag`:

```tsx
const dragProps = useDrag(() => ({
  kind: "note",
  id: n.id,
  contextBinId: currentBinId ?? null,
}));

// On the <button> or <li>:
<li
  key={n.id}
  {...dragProps}
  onContextMenu={(e) => handleNoteContext(e, n)}
>
  {/* existing content */}
  {(noteBins?.get(n.id)?.length ?? 0) > 1 && (
    <span className="ml-2 font-mono text-xs text-text-secondary">
      ·{noteBins!.get(n.id)!.length}
    </span>
  )}
</li>
```

Below the list, render the BinPicker for add/move:

```tsx
{pickerNote && (
  <BinPicker
    open={pickerOpen}
    title={pickerMode === "add" ? "Add to bin…" : "Move to bin…"}
    onClose={() => { setPickerOpen(false); setPickerNote(null); }}
    alreadyInIds={noteBins?.get(pickerNote.id) ?? []}
    disableAlreadyIn={pickerMode === "add"}
    onPick={async (targetId) => {
      if (!targetId) return;
      try {
        if (pickerMode === "add") {
          const res = await fetch(`/api/bins/${targetId}/assign`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ note_id: pickerNote.id }),
          });
          if (!res.ok) throw new Error(`Add failed (${res.status})`);
          show("Added to bin", "info");
        } else {
          const fromBinId = currentBinId ?? (noteBins?.get(pickerNote.id) ?? [])[0];
          if (!fromBinId) throw new Error("No source bin to move from");
          const res = await fetch(`/api/notes/${pickerNote.id}/move`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ from_bin_id: fromBinId, to_bin_id: targetId }),
          });
          if (!res.ok) throw new Error(`Move failed (${res.status})`);
          show("Moved to bin", "info");
        }
        onMutated?.();
      } catch (err) {
        show(err instanceof Error ? err.message : "Failed", "error");
      }
    }}
  />
)}
```

- [ ] **Step 3: Pass `currentBinId` and a refetch callback from page contexts**

Note: both pages already use `const [reading, setReading] = useState<string | null>(null)` for the ReadingPane — keep that. The new addition is just `refreshKey` and the new NoteList props.

In `app/bins/[id]/page.tsx`, add a `refreshKey` state. Find the existing `useEffect` that fetches notes; add `refreshKey` to its dependency array. Add the new props to the existing `<NoteList>`:

```tsx
const [refreshKey, setRefreshKey] = useState(0);

// existing useEffect, with refreshKey added to deps:
useEffect(() => {
  fetch(`/api/notes?bin=${params.id}`).then((r) => r.json()).then((d) => setNotes(d.notes ?? []));
}, [params.id, refreshKey]);

// existing <NoteList /> — add currentBinId + onMutated, keep onNoteClick + selectedPath:
<NoteList
  notes={notes}
  onNoteClick={(n) => setReading(n.vault_path)}
  selectedPath={reading}
  currentBinId={params.id}
  onMutated={() => setRefreshKey((k) => k + 1)}
/>
```

In `app/bins/page.tsx` (Recent view), apply the same pattern:

```tsx
const [refreshKey, setRefreshKey] = useState(0);

useEffect(() => {
  fetch("/api/notes?limit=100").then((r) => r.json()).then((d) => setNotes(d.notes ?? []));
}, [refreshKey]);

// existing <NoteList /> — add currentBinId={null} + onMutated:
<NoteList
  notes={notes}
  onNoteClick={(n) => setReading(n.vault_path)}
  selectedPath={reading}
  currentBinId={null}
  onMutated={() => setRefreshKey((k) => k + 1)}
/>
```

`noteBins` prop stays undefined for v1.2.1 — the multi-bin badge requires extending `GET /api/notes` to include `bins[]` per note. That's a deliberate scope deferral (per spec §5.2): the badge will simply not show. Follow-up: add a `bins` field to the notes-list response in a future task.

- [ ] **Step 4: Update BinTree note-drop handler**

In `components/BinTree.tsx`, in the `BinRow` `useDrop` handler, replace the stubbed note handling from Task 23:

```tsx
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
```

(Add `const isCommandHeldRef = useIsCommandHeld();` at the top of the BinRow function. Already imported in Task 23.)

- [ ] **Step 5: Verify type-check**

Run: `npx tsc --noEmit`

Expected: clean.

- [ ] **Step 6: Manual smoke**

Run dev server. Test:
1. Right-click note → menu shows Open + Add to bin + (Move to bin if /bins/[id]) + (Remove from this bin if /bins/[id])
2. Drag note onto sidebar bin → toast "Added to '{name}'"
3. Hold ⌘, drag note from /bins/[id] onto another sidebar bin → toast "Moved to '{name}'"
4. Hold ⌘, drag from /bins (Recent) view → toast "Hold ⌘ to move only when a single source bin is clear" + add fallback applied

Kill dev server.

- [ ] **Step 7: Commit**

```bash
git add components/NoteList.tsx components/BinTree.tsx app/bins/page.tsx app/bins/[id]/page.tsx
git commit -m "feat(notes): note context menu, drag source, BinTree note-drop with ⌘-move"
```

---

## Task 25: Manual smoke test + lint/typecheck/test gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: ALL tests pass. Target ~175 (160 existing + ~15 new from this plan). Confirm count.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: clean (no errors).

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`

Expected: clean (no errors).

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: clean build.

- [ ] **Step 5: Manual smoke test in dev**

Run: `VAULT_PATH=$HOME/Vault PORT=3001 npm run dev`

Open http://localhost:3001 and walk this checklist:

1. Click `+` next to bin filter → Modal opens → type "Test 1" → Enter → bin appears, selected, toast appears
2. Right-click "Test 1" → "New child bin" → name "Sub" → Enter → child appears nested
3. Right-click "Sub" → "Rename" → input appears with name selected → type "Sub-renamed" → Enter → renames
4. Right-click "Sub-renamed" → "Rename" → press Esc → reverts
5. Drag "Sub-renamed" onto a different top-level bin → re-parents
6. Drag "Sub-renamed" between two siblings → reorders (cyan line shows between rows during drag)
7. Drag "Sub-renamed" onto itself → red dashed ring, no action on drop
8. On `/bins/[id]` (any bin with notes), right-click a note → menu shows Open / Add to bin / Move to bin / Remove from this bin
9. Right-click → Add to bin → picker → confirm → toast "Added to bin"
10. Right-click → Move to bin → picker → confirm → note disappears from this view → appears in target
11. Drag a note onto a sidebar bin → toast "Added to '{name}'"
12. On `/bins/[id]`, hold ⌘, drag note onto sidebar bin → toast "Moved to '{name}'"; note no longer in current view
13. On `/bins` (Recent), hold ⌘, drag → "Hold ⌘ to move only when a single source bin is clear" warning toast + Add applied
14. Right-click bin → "Merge into…" → pick target → confirm dialog → confirm → source bin gone, target selected
15. Right-click bin with sub-bins + notes → "Delete" → preview shows correct counts → confirm → bin gone, selection moves to parent
16. Right-click `notion-sync` (or any seeded bin if present) → no Delete option in menu
17. Empty bin tree (delete all bins to test) → "+ Create your first bin" CTA appears

If ANY step fails, document the failure, fix, and re-run that step plus the full test suite.

- [ ] **Step 6: Final commit**

(No code changes — but a clean tree is fine.)

```bash
git status
# Should show no uncommitted changes if all prior tasks committed cleanly.
```

If everything passes, the implementation is complete. Plan execution is done.

- [ ] **Step 7: Update CLAUDE.md to reflect v1.2.1 shipped**

In `CLAUDE.md`, under "Current state", note that v1.2.1 is now complete on the same branch. Bump roadmap pointer to v1.3 (whole-note classifier) as next.

```bash
# After editing CLAUDE.md:
git add CLAUDE.md
git commit -m "docs: mark v1.2.1 complete in CLAUDE.md, point roadmap to v1.3"
```

---

## Acceptance criteria (mirrors spec §12)

v1.2.1 is done when all of these are true:

1. ☐ User can create a 5-level-deep bin hierarchy entirely from the sidebar
2. ☐ Right-clicking any bin shows the full menu (or seeded variant for `notion-sync`)
3. ☐ Right-clicking any note row shows Open / Add to bin / Move to bin / Remove from this bin (with appropriate visibility rules)
4. ☐ Dragging a note onto a sidebar bin adds it; ⌘-drag moves it (when source unambiguous)
5. ☐ Dragging a bin onto another bin re-parents; dragging within siblings reorders
6. ☐ Deleting a non-empty bin shows the preview with correct counts
7. ☐ Merging a bin re-parents its children to the target (regression-tested)
8. ☐ All previously-passing tests still pass; ~15 new tests added
9. ☐ Manual smoke test (Task 25 Step 5) passes
10. ☐ Build, lint, typecheck all clean
