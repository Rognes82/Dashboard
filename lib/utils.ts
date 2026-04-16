import { ulid } from "ulid";

export const ACTIVITY_BORDER_COLORS: Record<string, string> = {
  git: "border-accent-green",
  notion: "border-accent-green",
  gdrive: "border-accent-green",
  discord: "border-accent-green",
  files: "border-accent-green",
  system: "border-accent-amber",
};

export function activityBorderColor(source: string): string {
  return ACTIVITY_BORDER_COLORS[source] ?? "border-accent-green";
}

export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function formatRelativeTime(isoString: string | null | undefined): string {
  if (!isoString) return "unknown";
  const parsed = new Date(isoString).getTime();
  if (!Number.isFinite(parsed)) return "unknown";
  const diffMs = Date.now() - parsed;
  if (diffMs < 0) return "just now";
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.floor(diffDay / 7);
  return `${diffWk}w ago`;
}
