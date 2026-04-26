import { describe, it, expect } from "vitest";
import { type LlmProfile } from "../../../lib/llm/types";
import { buildClassifierLlm } from "../../../lib/classify/llm-adapter";

describe("buildClassifierLlm", () => {
  it("returns a ClassifierLlm with modelName from profile.default_model", () => {
    const profile: LlmProfile = {
      id: "p1",
      name: "test",
      type: "anthropic",
      api_key_encrypted: "x",
      default_model: "claude-haiku-4-5",
      max_context_tokens: 200000,
      created_at: "2026-01-01",
    };
    const adapter = buildClassifierLlm(profile);
    expect(adapter.modelName).toBe("claude-haiku-4-5");
    expect(typeof adapter.complete).toBe("function");
  });
});
