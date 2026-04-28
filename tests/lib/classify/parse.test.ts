import { describe, it, expect } from "vitest";
import { parseClassifierOutput, ClassifierOutputError } from "../../../lib/classify/parse";

describe("parseClassifierOutput", () => {
  it("parses a valid existing-only response", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "travel/japan", confidence: 0.85, reasoning: "About Japan trip" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    });
    const result = parseClassifierOutput(json);
    expect(result.existing_match.bin_path).toBe("travel/japan");
    expect(result.existing_match.confidence).toBe(0.85);
    expect(result.proposed_new_bin).toBeNull();
  });

  it("parses a valid new-bin response", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "business", confidence: 0.31, reasoning: "Loosely about business" },
      proposed_new_bin: { path: "business/planning/okrs", rating: 0.82, reasoning: "Q3 OKRs doc" },
      no_fit_reasoning: null,
    });
    const result = parseClassifierOutput(json);
    expect(result.proposed_new_bin?.path).toBe("business/planning/okrs");
    expect(result.proposed_new_bin?.rating).toBe(0.82);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseClassifierOutput("not json")).toThrow(ClassifierOutputError);
  });

  it("throws on missing required fields", () => {
    const json = JSON.stringify({ existing_match: { bin_path: "x" } });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("throws on out-of-range confidence", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "x", confidence: 1.5, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("throws on empty bin_path", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "", confidence: 0.5, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("throws on empty proposed_new_bin.path", () => {
    const json = JSON.stringify({
      existing_match: { bin_path: "a", confidence: 0.5, reasoning: "r" },
      proposed_new_bin: { path: "", rating: 0.8, reasoning: "r" },
      no_fit_reasoning: null,
    });
    expect(() => parseClassifierOutput(json)).toThrow(ClassifierOutputError);
  });

  it("strips fenced code blocks before parsing", () => {
    const fenced = "```json\n" + JSON.stringify({
      existing_match: { bin_path: "a", confidence: 0.5, reasoning: "r" },
      proposed_new_bin: null,
      no_fit_reasoning: null,
    }) + "\n```";
    const result = parseClassifierOutput(fenced);
    expect(result.existing_match.bin_path).toBe("a");
  });
});
