import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "../../../lib/llm/prompt";

describe("buildSystemPrompt", () => {
  it("includes citation instruction and scope context", () => {
    const sp = buildSystemPrompt({ user_name: "Carter", scope_path: "content/reels/tokyo" });
    expect(sp).toContain("<citations>");
    expect(sp).toContain("<cite path");
    expect(sp).toContain("content/reels/tokyo");
    expect(sp).toContain("Carter");
  });

  it("omits scope section when scope_path is null", () => {
    const sp = buildSystemPrompt({ user_name: "Carter", scope_path: null });
    expect(sp).not.toContain("Current scope:");
  });
});

describe("buildUserMessage", () => {
  it("formats context blocks and appends the question", () => {
    const result = buildUserMessage({
      question: "What tokyo ideas?",
      context_notes: [
        { vault_path: "notes/a.md", body: "alpha body" },
        { vault_path: "notes/b.md", body: "beta body" },
      ],
    });
    expect(result).toContain("=== notes/a.md ===");
    expect(result).toContain("alpha body");
    expect(result).toContain("=== notes/b.md ===");
    expect(result).toContain("beta body");
    expect(result).toContain("What tokyo ideas?");
    // Question comes after context
    expect(result.indexOf("What tokyo ideas?")).toBeGreaterThan(result.indexOf("alpha body"));
  });

  it("handles empty context with a marker", () => {
    const result = buildUserMessage({ question: "anything?", context_notes: [] });
    expect(result).toContain("anything?");
    expect(result).toContain("No relevant notes");
  });
});
