import { getDb } from "../db";
import { newId, nowIso } from "../utils";
import type { Bin, BinNode, AssignedBy } from "../types";

/**
 * Thrown by moveNoteBetweenBins when the note isn't in the source bin.
 * The API route checks `instanceof NoteNotInSourceBinError` to map it to a 400.
 */
export class NoteNotInSourceBinError extends Error {
  constructor(public readonly noteId: string, public readonly fromBinId: string) {
    super(`Note ${noteId} not in source bin ${fromBinId}`);
    this.name = "NoteNotInSourceBinError";
  }
}

export function createBin(input: {
  name: string;
  parent_bin_id?: string | null;
  source_seed?: string | null;
  sort_order?: number;
}): Bin {
  const db = getDb();
  const id = newId();
  db.prepare(
    `INSERT INTO bins (id, name, parent_bin_id, source_seed, created_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.name,
    input.parent_bin_id ?? null,
    input.source_seed ?? null,
    nowIso(),
    input.sort_order ?? 0
  );
  return getBinById(id)!;
}

export function getBinById(id: string): Bin | null {
  const row = getDb().prepare("SELECT * FROM bins WHERE id = ?").get(id) as Bin | undefined;
  return row ?? null;
}

export function getBinBySeed(source_seed: string): Bin | null {
  const row = getDb().prepare("SELECT * FROM bins WHERE source_seed = ?").get(source_seed) as Bin | undefined;
  return row ?? null;
}

export function getOrCreateBinBySeed(input: {
  source_seed: string;
  name: string;
  parent_bin_id?: string | null;
}): Bin {
  const existing = getBinBySeed(input.source_seed);
  if (existing) return existing;
  return createBin({
    name: input.name,
    parent_bin_id: input.parent_bin_id ?? null,
    source_seed: input.source_seed,
  });
}

export function listBins(): Bin[] {
  return getDb().prepare("SELECT * FROM bins ORDER BY sort_order ASC, name ASC").all() as Bin[];
}

export function listBinTree(): BinNode[] {
  const db = getDb();
  const bins = listBins();
  const counts = db
    .prepare(
      `SELECT bin_id, COUNT(*) as n FROM note_bins
       JOIN vault_notes ON vault_notes.id = note_bins.note_id AND vault_notes.deleted_at IS NULL
       GROUP BY bin_id`
    )
    .all() as { bin_id: string; n: number }[];
  const countMap = new Map(counts.map((c) => [c.bin_id, c.n]));
  const nodeMap = new Map<string, BinNode>();
  for (const bin of bins) {
    nodeMap.set(bin.id, { ...bin, children: [], note_count: countMap.get(bin.id) ?? 0 });
  }
  const roots: BinNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_bin_id && nodeMap.has(node.parent_bin_id)) {
      nodeMap.get(node.parent_bin_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function updateBin(id: string, input: {
  name?: string;
  parent_bin_id?: string | null;
  sort_order?: number;
}): Bin | null {
  const existing = getBinById(id);
  if (!existing) return null;
  const db = getDb();
  db.prepare(
    "UPDATE bins SET name = ?, parent_bin_id = ?, sort_order = ? WHERE id = ?"
  ).run(
    input.name ?? existing.name,
    input.parent_bin_id === undefined ? existing.parent_bin_id : input.parent_bin_id,
    input.sort_order ?? existing.sort_order,
    id
  );
  return getBinById(id);
}

export function deleteBin(id: string): void {
  getDb().prepare("DELETE FROM bins WHERE id = ?").run(id);
}

export function assignNoteToBin(input: {
  note_id: string;
  bin_id: string;
  assigned_by: AssignedBy;
}): void {
  getDb().prepare(
    `INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(note_id, bin_id) DO NOTHING`
  ).run(input.note_id, input.bin_id, nowIso(), input.assigned_by);
}

export function unassignNoteFromBin(note_id: string, bin_id: string): void {
  getDb().prepare("DELETE FROM note_bins WHERE note_id = ? AND bin_id = ?").run(note_id, bin_id);
}

export function listBinsForNote(note_id: string): Bin[] {
  return getDb()
    .prepare(
      `SELECT b.* FROM bins b
       JOIN note_bins nb ON nb.bin_id = b.id
       WHERE nb.note_id = ?
       ORDER BY b.name ASC`
    )
    .all(note_id) as Bin[];
}

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
    if (!inSource) throw new NoteNotInSourceBinError(noteId, fromBinId);
    db.prepare("DELETE FROM note_bins WHERE note_id = ? AND bin_id = ?").run(noteId, fromBinId);
    db.prepare(
      `INSERT INTO note_bins (note_id, bin_id, assigned_at, assigned_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(note_id, bin_id) DO NOTHING`
    ).run(noteId, toBinId, nowIso(), "manual");
  });
  tx();
}

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
