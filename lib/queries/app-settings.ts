import { getDb } from "../db";
import { nowIso } from "../utils";

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, nowIso());
}

export function deleteSetting(key: string): void {
  getDb().prepare("DELETE FROM app_settings WHERE key = ?").run(key);
}

export function getSettingJson<T>(key: string): T | null {
  const raw = getSetting(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setSettingJson(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}
