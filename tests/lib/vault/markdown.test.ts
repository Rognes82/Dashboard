import { describe, it, expect } from "vitest";
import { markdownToPlainText, deriveTitle } from "../../../lib/vault/markdown";

describe("markdownToPlainText", () => {
  it("strips headings, emphasis, and code fences", () => {
    const md = `# Heading
Some **bold** and *italic* text.

\`\`\`typescript
const x = 1;
\`\`\`

And a [link](https://example.com).`;
    const out = markdownToPlainText(md);
    expect(out).toContain("Heading");
    expect(out).toContain("bold");
    expect(out).toContain("italic");
    expect(out).toContain("link");
    expect(out).not.toContain("**");
    expect(out).not.toContain("```");
    expect(out).not.toContain("https://example.com");
  });

  it("flattens wikilinks to their display text", () => {
    expect(markdownToPlainText("See [[Project Alpha]] and [[Note|shown]].")).toContain("Project Alpha");
    expect(markdownToPlainText("See [[Note|shown]].")).toContain("shown");
  });
});

describe("deriveTitle", () => {
  it("uses frontmatter title if present", () => {
    expect(deriveTitle({ title: "From Front" }, "# Heading\nbody", "fallback.md")).toBe("From Front");
  });

  it("falls back to first heading", () => {
    expect(deriveTitle({}, "# Heading\nbody", "fallback.md")).toBe("Heading");
  });

  it("falls back to filename sans extension when no heading", () => {
    expect(deriveTitle({}, "just text", "notes/my-note.md")).toBe("my-note");
  });
});
