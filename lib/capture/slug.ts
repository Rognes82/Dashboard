const WORD_RE = /[A-Za-z0-9]+/g;

export function captureSlug(text: string): string {
  const stripped = text.toLowerCase().replace(/['']/g, "");
  const words = stripped.match(WORD_RE) ?? [];
  if (words.length < 3) return "capture";
  return words.slice(0, 5).join("-");
}

export function captureFilename(date: Date, slug: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const Y = date.getUTCFullYear();
  const M = pad(date.getUTCMonth() + 1);
  const D = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const m = pad(date.getUTCMinutes());
  return `${Y}-${M}-${D}-${h}-${m}-${slug}.md`;
}
