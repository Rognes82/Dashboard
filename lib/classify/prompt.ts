const MAX_BODY_CHARS = 24000;

export function buildSystemPrompt(binTree: Map<string, string>): string {
  const paths = Array.from(binTree.keys()).sort();
  const treeBlock = paths.length > 0 ? paths.join("\n") : "(empty bin tree)";
  return `You are a knowledge organizer for a personal vault. Classify the given note into the single best-fitting bin from the tree below.

Rules:
1. Return your top-1 best-matching existing bin with a confidence score in [0, 1].
2. If you believe NO existing bin is a good fit, ALSO propose a new bin path under an existing parent. Provide a rating in [0, 1].
3. If neither would be appropriate, fill \`no_fit_reasoning\` and leave both null/low.
4. ALWAYS use lowercase paths with hyphens, exactly matching the slugs shown below (e.g. \`business-planning/okrs\`, never \`Business Planning/OKRs\`).

Confidence/rating calibration:
  0.9+    = certain
  0.7-0.9 = confident
  0.5-0.7 = likely
  <0.5    = uncertain — say so honestly

Strong preference for existing bins. Only propose new bins when the existing tree genuinely cannot accommodate the content.

Bin tree (canonical slug paths):
${treeBlock}

Return JSON matching this schema:
{
  "existing_match": { "bin_path": string, "confidence": number, "reasoning": string },
  "proposed_new_bin": { "path": string, "rating": number, "reasoning": string } | null,
  "no_fit_reasoning": string | null
}`;
}

interface NoteForPrompt {
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function buildNoteUserMessage(note: NoteForPrompt): string {
  const fm = { ...note.frontmatter };
  delete (fm as { bins?: unknown }).bins;
  const fmBlock = Object.keys(fm).length > 0 ? `Frontmatter: ${JSON.stringify(fm)}\n\n` : "";
  let body = note.body;
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS) + "\n\n[truncated]";
  }
  return `Title: ${note.title}\n\n${fmBlock}${body}`;
}
