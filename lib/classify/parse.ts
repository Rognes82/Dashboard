import { z } from "zod";

export class ClassifierOutputError extends Error {
  constructor(message: string, public readonly raw: string) {
    super(message);
    this.name = "ClassifierOutputError";
  }
}

const ClassifierOutputSchema = z.object({
  existing_match: z.object({
    bin_path: z.string().min(1),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().min(1),
  }),
  proposed_new_bin: z
    .object({
      path: z.string().min(1),
      rating: z.number().min(0).max(1),
      reasoning: z.string().min(1),
    })
    .nullable(),
  no_fit_reasoning: z.string().nullable(),
});

export type ClassifierOutput = z.infer<typeof ClassifierOutputSchema>;

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

export function parseClassifierOutput(raw: string): ClassifierOutput {
  const cleaned = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new ClassifierOutputError(`Not valid JSON: ${(e as Error).message}`, raw);
  }
  const result = ClassifierOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new ClassifierOutputError(`Schema mismatch: ${result.error.message}`, raw);
  }
  return result.data;
}
