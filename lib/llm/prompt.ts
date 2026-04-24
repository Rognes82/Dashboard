export interface SystemPromptOptions {
  user_name: string;
  scope_path: string | null;
}

export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const scopeBlock = opts.scope_path
    ? `\n\nCurrent scope: ${opts.scope_path} — the notes below are from this bin.\n`
    : "\n";
  return [
    `You are the agent for ${opts.user_name}'s personal knowledge vault.`,
    "Answer ONLY using the provided notes. Be concise — 2-4 short paragraphs or a short list.",
    "If the answer isn't in the notes, say so plainly.",
    scopeBlock,
    "After your prose answer, emit a <citations>...</citations> block listing the vault_paths you used,",
    'one per <cite path="..."/> element. If no notes were useful, emit <citations/>.',
    "Do not cite a path that wasn't in the provided notes.",
  ].join("");
}

export interface ContextNote {
  vault_path: string;
  body: string;
}

export interface UserMessageOptions {
  question: string;
  context_notes: ContextNote[];
}

export function buildUserMessage(opts: UserMessageOptions): string {
  const contextBlocks =
    opts.context_notes.length === 0
      ? "[No relevant notes found — answer only if the question is about general workspace state.]"
      : opts.context_notes
          .map((n) => `=== ${n.vault_path} ===\n${n.body}`)
          .join("\n\n");
  return `${contextBlocks}\n\n---\n\n${opts.question}`;
}
