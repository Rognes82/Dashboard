export interface RichTextSpan {
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    code?: boolean;
    strikethrough?: boolean;
  };
  href?: string | null;
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  children?: NotionBlock[];
  // One of these payload shapes based on type
  paragraph?: { rich_text: RichTextSpan[] };
  heading_1?: { rich_text: RichTextSpan[] };
  heading_2?: { rich_text: RichTextSpan[] };
  heading_3?: { rich_text: RichTextSpan[] };
  bulleted_list_item?: { rich_text: RichTextSpan[] };
  numbered_list_item?: { rich_text: RichTextSpan[] };
  to_do?: { rich_text: RichTextSpan[]; checked: boolean };
  toggle?: { rich_text: RichTextSpan[] };
  quote?: { rich_text: RichTextSpan[] };
  callout?: { rich_text: RichTextSpan[] };
  code?: { language: string; rich_text: RichTextSpan[] };
}

function richText(spans: RichTextSpan[] | undefined): string {
  if (!spans) return "";
  return spans
    .map((s) => {
      const a = s.annotations ?? {};
      const hasWrap =
        !!a.code || !!a.italic || !!a.bold || !!a.strikethrough || !!s.href;
      // Hoist leading/trailing whitespace outside wrappers so markers close cleanly.
      const match = hasWrap ? /^(\s*)([\s\S]*?)(\s*)$/.exec(s.plain_text) : null;
      const lead = match ? match[1] : "";
      let out = match ? match[2] : s.plain_text;
      const trail = match ? match[3] : "";
      if (a.code) out = "`" + out + "`";
      if (a.italic) out = "*" + out + "*";
      if (a.bold) out = "**" + out + "**";
      if (a.strikethrough) out = "~~" + out + "~~";
      if (s.href) out = "[" + out + "](" + s.href + ")";
      return lead + out + trail;
    })
    .join("");
}

function renderBlock(block: NotionBlock, depth: number): string {
  const indent = "  ".repeat(depth);
  switch (block.type) {
    case "paragraph":
      return indent + richText(block.paragraph?.rich_text);
    case "heading_1":
      return indent + "# " + richText(block.heading_1?.rich_text);
    case "heading_2":
      return indent + "## " + richText(block.heading_2?.rich_text);
    case "heading_3":
      return indent + "### " + richText(block.heading_3?.rich_text);
    case "bulleted_list_item":
      return indent + "- " + richText(block.bulleted_list_item?.rich_text);
    case "numbered_list_item":
      return indent + "1. " + richText(block.numbered_list_item?.rich_text);
    case "to_do":
      return (
        indent +
        "- [" +
        (block.to_do?.checked ? "x" : " ") +
        "] " +
        richText(block.to_do?.rich_text)
      );
    case "toggle":
      return indent + "- " + richText(block.toggle?.rich_text);
    case "quote":
      return indent + "> " + richText(block.quote?.rich_text);
    case "callout":
      return indent + "> " + richText(block.callout?.rich_text);
    case "code":
      return (
        indent +
        "```" +
        (block.code?.language ?? "") +
        "\n" +
        richText(block.code?.rich_text) +
        "\n" +
        indent +
        "```"
      );
    case "divider":
      return indent + "---";
    default:
      return indent + `<!-- unsupported: ${block.type} -->`;
  }
}

export function blocksToMarkdown(blocks: NotionBlock[], depth = 0): string {
  const lines: string[] = [];
  for (const block of blocks) {
    lines.push(renderBlock(block, depth));
    if (block.has_children && block.children && block.children.length > 0) {
      lines.push(blocksToMarkdown(block.children, depth + 1));
    }
  }
  return lines.filter((l) => l.length > 0).join("\n\n");
}
