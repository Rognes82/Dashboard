import { describe, it, expect } from "vitest";
import { parseFrontmatter, extractInlineTags } from "../../../lib/vault/frontmatter";

describe("parseFrontmatter", () => {
  it("extracts frontmatter fields and body", () => {
    const raw = `---
source: notion
source_id: abc-123
tags: [reels, tokyo]
bins: [bin-1, bin-2]
---
# Hello

This is the body.
`;
    const result = parseFrontmatter(raw);
    expect(result.data.source).toBe("notion");
    expect(result.data.source_id).toBe("abc-123");
    expect(result.data.tags).toEqual(["reels", "tokyo"]);
    expect(result.data.bins).toEqual(["bin-1", "bin-2"]);
    expect(result.body.trim()).toBe("# Hello\n\nThis is the body.");
  });

  it("returns empty data and raw body when there is no frontmatter", () => {
    const raw = "# Just a heading\n\nSome body.";
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({});
    expect(result.body).toBe(raw);
  });

  it("extracts inline hashtags from the body", () => {
    const raw = "Text with #tag1 and #nested/tag2 but not in code `#notag`.";
    const tags = extractInlineTags(raw);
    expect(tags).toContain("tag1");
    expect(tags).toContain("nested/tag2");
    expect(tags).not.toContain("notag");
  });
});
