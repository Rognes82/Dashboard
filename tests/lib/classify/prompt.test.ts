import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildNoteUserMessage } from "../../../lib/classify/prompt";

describe("buildSystemPrompt", () => {
  it("includes the bin tree as slug paths", () => {
    const tree = new Map<string, string>([
      ["travel", "b-travel"],
      ["travel/japan", "b-jp"],
    ]);
    const out = buildSystemPrompt(tree);
    expect(out).toContain("travel\ntravel/japan");
  });

  it("instructs lowercase + hyphen path format", () => {
    const out = buildSystemPrompt(new Map());
    expect(out).toMatch(/lowercase paths with hyphens/i);
  });

  it("specifies the JSON output schema", () => {
    const out = buildSystemPrompt(new Map());
    expect(out).toContain("existing_match");
    expect(out).toContain("proposed_new_bin");
    expect(out).toContain("no_fit_reasoning");
  });

  it("sorts bin paths alphabetically for cache stability", () => {
    const tree = new Map<string, string>([
      ["zebra", "b-z"],
      ["apple", "b-a"],
      ["mango", "b-m"],
    ]);
    const out = buildSystemPrompt(tree);
    const aIdx = out.indexOf("apple");
    const mIdx = out.indexOf("mango");
    const zIdx = out.indexOf("zebra");
    expect(aIdx).toBeLessThan(mIdx);
    expect(mIdx).toBeLessThan(zIdx);
  });
});

describe("buildNoteUserMessage", () => {
  it("includes title and body", () => {
    const out = buildNoteUserMessage({ title: "Tokyo trip", frontmatter: {}, body: "Itinerary draft" });
    expect(out).toContain("Tokyo trip");
    expect(out).toContain("Itinerary draft");
  });

  it("strips bins from frontmatter (already used for override)", () => {
    const out = buildNoteUserMessage({
      title: "X",
      frontmatter: { tags: ["travel"], bins: ["travel/japan"] },
      body: "B",
    });
    expect(out).toContain("tags");
    expect(out).not.toContain('"travel/japan"');
  });

  it("truncates body over ~6000 tokens (~24000 chars)", () => {
    const longBody = "x".repeat(40000);
    const out = buildNoteUserMessage({ title: "T", frontmatter: {}, body: longBody });
    expect(out.length).toBeLessThan(30000);
    expect(out).toContain("[truncated]");
  });
});
