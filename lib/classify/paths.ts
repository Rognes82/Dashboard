import { slugify } from "../utils";

export interface BinRow {
  id: string;
  name: string;
  parent_bin_id: string | null;
}

export function slugifyPath(bin: BinRow, allBins: BinRow[]): string {
  const segments: string[] = [];
  let cur: BinRow | undefined = bin;
  while (cur) {
    const seg = slugify(cur.name);
    if (!seg) return "";
    segments.unshift(seg);
    cur = cur.parent_bin_id
      ? allBins.find((b) => b.id === cur!.parent_bin_id)
      : undefined;
  }
  return segments.join("/");
}

export function buildBinTree(allBins: BinRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const bin of allBins) {
    const path = slugifyPath(bin, allBins);
    if (path) map.set(path, bin.id);
  }
  return map;
}

export function parentOf(slugPath: string): string | null {
  const idx = slugPath.lastIndexOf("/");
  if (idx === -1) return null;
  return slugPath.slice(0, idx);
}

export function tail(slugPath: string): string {
  const idx = slugPath.lastIndexOf("/");
  return idx === -1 ? slugPath : slugPath.slice(idx + 1);
}

export function normalizeLlmPath(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\/+/g, "/")
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/")
    .map((s) => slugify(s))
    .filter((s) => s.length > 0)
    .join("/");
}
