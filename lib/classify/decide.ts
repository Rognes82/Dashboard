import type { ClassifierOutput } from "./parse";
import { normalizeLlmPath, parentOf, tail } from "./paths";

export interface Thresholds {
  existing_min: number;
  new_bin_floor: number;
  new_bin_margin: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  existing_min: 0.6,
  new_bin_floor: 0.75,
  new_bin_margin: 0.3,
};

export type Decision =
  | { action: "auto_assign"; bin_id: string; confidence_used: number; converted_from_new_bin: boolean }
  | {
      action: "auto_create_bin";
      path: string;
      parent_bin_id: string;
      slug: string;
      name: string;
      rating: number;
    }
  | {
      action: "pending";
      existing_bin_id: string | null;
      existing_confidence: number;
      new_bin_path: string | null;
      new_bin_rating: number | null;
      no_fit_reasoning: string | null;
    };

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function decide(
  parsed: ClassifierOutput,
  thresholds: Thresholds,
  binTree: Map<string, string>,
): Decision {
  const existingPath = normalizeLlmPath(parsed.existing_match.bin_path);
  const existingConfidence = parsed.existing_match.confidence;
  const newPath = parsed.proposed_new_bin ? normalizeLlmPath(parsed.proposed_new_bin.path) : null;
  const newRating = parsed.proposed_new_bin?.rating ?? null;

  // (1) Proposed-path-already-exists short-circuit.
  if (newPath && binTree.has(newPath)) {
    return {
      action: "auto_assign",
      bin_id: binTree.get(newPath)!,
      confidence_used: newRating ?? 0,
      converted_from_new_bin: true,
    };
  }

  // (2) Auto-create new-bin gate.
  if (newPath && newRating !== null) {
    const margin = newRating - existingConfidence;
    const parentPath = parentOf(newPath);
    const parentExists = parentPath !== null && binTree.has(parentPath);
    if (
      newRating >= thresholds.new_bin_floor &&
      margin >= thresholds.new_bin_margin &&
      parentExists
    ) {
      const slug = tail(newPath);
      return {
        action: "auto_create_bin",
        path: newPath,
        parent_bin_id: binTree.get(parentPath!)!,
        slug,
        name: titleCase(slug),
        rating: newRating,
      };
    }
  }

  // (3) Auto-assign existing-bin gate. Only when LLM did NOT propose a new bin —
  //     a present-but-failed new-bin proposal signals the LLM thinks the existing
  //     match is insufficient, so route to pending instead of falling back.
  if (
    !parsed.proposed_new_bin &&
    binTree.has(existingPath) &&
    existingConfidence >= thresholds.existing_min
  ) {
    return {
      action: "auto_assign",
      bin_id: binTree.get(existingPath)!,
      confidence_used: existingConfidence,
      converted_from_new_bin: false,
    };
  }

  // (4) Pending fallback.
  return {
    action: "pending",
    existing_bin_id: binTree.get(existingPath) ?? null,
    existing_confidence: existingConfidence,
    new_bin_path: newPath,
    new_bin_rating: newRating,
    no_fit_reasoning: parsed.no_fit_reasoning,
  };
}
