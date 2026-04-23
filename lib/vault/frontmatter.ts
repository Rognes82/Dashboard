import matter from "gray-matter";

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const { data, content } = matter(raw);
  return { data: data as Record<string, unknown>, body: content };
}

const INLINE_TAG_RE = /(?<![`\w])#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

export function extractInlineTags(body: string): string[] {
  const withoutFences = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const found = new Set<string>();
  for (const match of withoutFences.matchAll(INLINE_TAG_RE)) {
    found.add(match[1]);
  }
  return Array.from(found);
}
