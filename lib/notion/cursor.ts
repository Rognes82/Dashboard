export type NotionCursorMap = Record<string, string>;

export function parseCursor(raw: string | null | undefined): NotionCursorMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: NotionCursorMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeCursor(map: NotionCursorMap): string {
  return JSON.stringify(map);
}

export function updateCursor(map: NotionCursorMap, db_id: string, timestamp: string): NotionCursorMap {
  return { ...map, [db_id]: timestamp };
}

export function getDbCursor(map: NotionCursorMap, db_id: string): string | undefined {
  return map[db_id];
}
