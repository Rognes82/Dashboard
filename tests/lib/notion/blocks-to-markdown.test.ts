import { describe, it, expect } from "vitest";
import { blocksToMarkdown, type NotionBlock } from "../../../lib/notion/blocks-to-markdown";

function textBlock(type: string, text: string, extra: Partial<NotionBlock> = {}): NotionBlock {
  return {
    id: "b" + Math.random(),
    type,
    has_children: false,
    [type]: { rich_text: [{ plain_text: text, annotations: {} }] },
    ...extra,
  } as NotionBlock;
}

describe("blocksToMarkdown", () => {
  it("converts paragraphs and headings", () => {
    const blocks: NotionBlock[] = [
      textBlock("heading_1", "Title"),
      textBlock("paragraph", "Some body text."),
      textBlock("heading_2", "Subhead"),
      textBlock("paragraph", "More body."),
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("# Title");
    expect(md).toContain("## Subhead");
    expect(md).toContain("Some body text.");
    expect(md).toContain("More body.");
  });

  it("converts bulleted and numbered lists", () => {
    const md = blocksToMarkdown([
      textBlock("bulleted_list_item", "apple"),
      textBlock("bulleted_list_item", "banana"),
      textBlock("numbered_list_item", "first"),
      textBlock("numbered_list_item", "second"),
    ]);
    expect(md).toMatch(/- apple[\s\S]*- banana/);
    expect(md).toMatch(/1\. first[\s\S]*1\. second/);
  });

  it("converts to_do blocks to task list syntax", () => {
    const blocks: NotionBlock[] = [
      {
        id: "t1",
        type: "to_do",
        has_children: false,
        to_do: { rich_text: [{ plain_text: "done thing", annotations: {} }], checked: true },
      } as NotionBlock,
      {
        id: "t2",
        type: "to_do",
        has_children: false,
        to_do: { rich_text: [{ plain_text: "open thing", annotations: {} }], checked: false },
      } as NotionBlock,
    ];
    const md = blocksToMarkdown(blocks);
    expect(md).toContain("- [x] done thing");
    expect(md).toContain("- [ ] open thing");
  });

  it("renders code blocks with language", () => {
    const block: NotionBlock = {
      id: "c1",
      type: "code",
      has_children: false,
      code: { language: "typescript", rich_text: [{ plain_text: "const x = 1;", annotations: {} }] },
    } as NotionBlock;
    const md = blocksToMarkdown([block]);
    expect(md).toContain("```typescript");
    expect(md).toContain("const x = 1;");
    expect(md).toContain("```");
  });

  it("preserves bold/italic/code annotations in rich text", () => {
    const block: NotionBlock = {
      id: "p1",
      type: "paragraph",
      has_children: false,
      paragraph: {
        rich_text: [
          { plain_text: "plain ", annotations: {} },
          { plain_text: "bold ", annotations: { bold: true } },
          { plain_text: "italic ", annotations: { italic: true } },
          { plain_text: "code", annotations: { code: true } },
        ],
      },
    } as NotionBlock;
    const md = blocksToMarkdown([block]);
    expect(md).toContain("plain **bold** *italic* `code`");
  });

  it("recurses into children for nested lists", () => {
    const parent: NotionBlock = {
      id: "p1",
      type: "bulleted_list_item",
      has_children: true,
      bulleted_list_item: { rich_text: [{ plain_text: "parent", annotations: {} }] },
      children: [textBlock("bulleted_list_item", "child-a"), textBlock("bulleted_list_item", "child-b")],
    } as NotionBlock;
    const md = blocksToMarkdown([parent]);
    expect(md).toContain("- parent");
    expect(md).toContain("  - child-a");
    expect(md).toContain("  - child-b");
  });

  it("emits a placeholder comment for unsupported block types", () => {
    const block: NotionBlock = {
      id: "u1",
      type: "audio",
      has_children: false,
    } as NotionBlock;
    expect(blocksToMarkdown([block])).toContain("<!-- unsupported: audio");
  });

  it("handles empty input", () => {
    expect(blocksToMarkdown([])).toBe("");
  });
});
