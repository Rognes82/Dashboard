import path from "path";

const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const HEADING_RE = /^#{1,6}\s+/gm;
const EMPHASIS_RE = /(\*\*|__|\*|_)(.*?)\1/g;
const WIKILINK_RE = /!?\[\[([^\]|#^]+)(?:#[^\]|^]+)?(?:\^[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const MD_LINK_RE = /\[([^\]]+)\]\([^)]+\)/g;
const IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g;
const HR_RE = /^-{3,}\s*$/gm;

export function markdownToPlainText(md: string): string {
  let out = md;
  out = out.replace(FENCE_RE, " ");
  out = out.replace(INLINE_CODE_RE, (m) => m.slice(1, -1));
  out = out.replace(IMAGE_RE, " ");
  out = out.replace(WIKILINK_RE, (_m, target, alias) => alias ?? target);
  out = out.replace(MD_LINK_RE, "$1");
  out = out.replace(HEADING_RE, "");
  out = out.replace(EMPHASIS_RE, "$2");
  out = out.replace(HR_RE, "");
  out = out.replace(/\s+/g, " ").trim();
  return out;
}

const FIRST_HEADING_RE = /^#{1,6}\s+(.+?)\s*$/m;

export function deriveTitle(
  frontmatter: Record<string, unknown>,
  body: string,
  filePath: string
): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === "string" && fmTitle.trim().length > 0) return fmTitle.trim();
  const match = body.match(FIRST_HEADING_RE);
  if (match) return match[1].trim();
  return path.basename(filePath, path.extname(filePath));
}
