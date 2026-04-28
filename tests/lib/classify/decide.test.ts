import { describe, it, expect } from "vitest";
import { decide, DEFAULT_THRESHOLDS } from "../../../lib/classify/decide";
import type { ClassifierOutput } from "../../../lib/classify/parse";

const tree = new Map<string, string>([
  ["travel", "b-travel"],
  ["travel/japan", "b-jp"],
  ["business", "b-biz"],
  ["business/planning", "b-plan"],
]);

function existing(path: string, confidence: number): ClassifierOutput["existing_match"] {
  return { bin_path: path, confidence, reasoning: "test" };
}

function newBin(path: string, rating: number): NonNullable<ClassifierOutput["proposed_new_bin"]> {
  return { path, rating, reasoning: "test" };
}

describe("decide", () => {
  const T = DEFAULT_THRESHOLDS;

  it("auto_assign when existing.confidence >= existing_min and path resolves", () => {
    const out: ClassifierOutput = { existing_match: existing("travel/japan", 0.8), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_assign");
    if (result.action === "auto_assign") expect(result.bin_id).toBe("b-jp");
  });

  it("converts proposed_new_bin to auto_assign when path already exists in tree", () => {
    const out: ClassifierOutput = {
      existing_match: existing("travel", 0.4),
      proposed_new_bin: newBin("travel/japan", 0.95),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_assign");
    if (result.action === "auto_assign") {
      expect(result.bin_id).toBe("b-jp");
      expect(result.converted_from_new_bin).toBe(true);
      expect(result.confidence_used).toBe(0.95);
    }
  });

  it("auto_assign sets converted_from_new_bin = false on existing-bin match", () => {
    const out: ClassifierOutput = {
      existing_match: existing("travel/japan", 0.8),
      proposed_new_bin: null,
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    if (result.action === "auto_assign") {
      expect(result.converted_from_new_bin).toBe(false);
      expect(result.confidence_used).toBe(0.8);
    }
  });

  it("auto_create_bin when rating >= floor, margin >= margin_threshold, parent exists", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.3),
      proposed_new_bin: newBin("business/planning/okrs", 0.85),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_create_bin");
    if (result.action === "auto_create_bin") {
      expect(result.path).toBe("business/planning/okrs");
      expect(result.parent_bin_id).toBe("b-plan");
      expect(result.slug).toBe("okrs");
    }
  });

  it("pending when new-bin parent missing", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.3),
      proposed_new_bin: newBin("business/planning/okrs/q3", 0.9),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("pending when new-bin rating below floor", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.3),
      proposed_new_bin: newBin("business/planning/okrs", 0.7),
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("pending when new-bin margin below threshold", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.7),
      proposed_new_bin: newBin("business/planning/okrs", 0.8),
      no_fit_reasoning: null,
    };
    // margin = 0.1, < 0.3 threshold
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("pending when existing.confidence below threshold and no new-bin", () => {
    const out: ClassifierOutput = { existing_match: existing("travel/japan", 0.4), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("treats hallucinated path as confidence 0 → pending", () => {
    const out: ClassifierOutput = { existing_match: existing("nonexistent/path", 0.95), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("pending");
  });

  it("normalizes title-cased / spaced LLM paths before lookup", () => {
    const out: ClassifierOutput = { existing_match: existing("Travel/Japan", 0.8), proposed_new_bin: null, no_fit_reasoning: null };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_assign");
    if (result.action === "auto_assign") expect(result.bin_id).toBe("b-jp");
  });

  it("auto_create wins when both gates pass (precedence)", () => {
    const out: ClassifierOutput = {
      existing_match: existing("business", 0.6), // would auto_assign
      proposed_new_bin: newBin("business/planning/okrs", 0.95), // margin 0.35, rating > 0.75
      no_fit_reasoning: null,
    };
    const result = decide(out, T, tree);
    expect(result.action).toBe("auto_create_bin");
  });
});
