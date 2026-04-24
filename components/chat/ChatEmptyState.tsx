"use client";

interface Props {
  user_name: string;
  has_profile: boolean;
  suggested_prompts: string[];
  onPickPrompt: (p: string) => void;
  onGoToSettings: () => void;
}

export function ChatEmptyState({
  user_name,
  has_profile,
  suggested_prompts,
  onPickPrompt,
  onGoToSettings,
}: Props) {
  if (!has_profile) {
    return (
      <div className="max-w-md mx-auto text-center flex flex-col items-center gap-4">
        <div className="mono text-2xs text-text-subtle tracking-widest uppercase">Setup required</div>
        <div className="text-lg text-text-primary">Configure your first LLM profile</div>
        <p className="text-xs text-text-muted leading-relaxed">
          Add an Anthropic or OpenAI-compatible profile in Settings. The chat needs a provider to answer.
        </p>
        <button
          onClick={onGoToSettings}
          className="mono text-2xs px-3 py-1.5 bg-accent text-raised rounded-md font-medium hover:opacity-90"
        >
          Open Settings
        </button>
      </div>
    );
  }

  const greet = greetingForHour();
  return (
    <div className="w-full max-w-xl mx-auto text-center flex flex-col items-center gap-5">
      <div className="mono text-2xs text-text-subtle tracking-widest uppercase">
        {greet}, {user_name}
      </div>
      <div className="text-xl text-text-primary font-medium">Ask your workspace</div>
      {suggested_prompts.length > 0 && (
        <div className="flex gap-2 flex-wrap justify-center max-w-lg mt-2">
          {suggested_prompts.map((p, i) => (
            <button
              key={i}
              onClick={() => onPickPrompt(p)}
              className="mono text-2xs text-text-tertiary px-2.5 py-1.5 border border-border-default rounded-sm hover:bg-hover hover:text-text-primary"
            >
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function greetingForHour(): string {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
