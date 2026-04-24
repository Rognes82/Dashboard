"use client";

import { useEffect, useRef, useState } from "react";
import { SendIcon } from "../icons";

interface Props {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  presetText?: string;
}

export function ChatInput({ onSubmit, disabled, presetText }: Props) {
  const [value, setValue] = useState(presetText ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (presetText !== undefined) {
      setValue(presetText);
      ref.current?.focus();
    }
  }, [presetText]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="border-t border-border-subtle px-6 py-4">
      <div className="max-w-3xl mx-auto">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask your workspace…"
          rows={3}
          aria-label="Chat input"
          disabled={disabled}
          className="w-full bg-sunken border border-border-strong rounded-lg px-4 py-3 text-sm text-text-primary placeholder:text-text-subtle resize-none focus:border-accent focus:outline-none focus:shadow-[0_0_0_3px_rgba(125,211,252,0.06)] disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="mono text-2xs text-text-dim">
            ↵ send · <span className="text-accent">⌘⇧C</span> capture
          </div>
          <button
            onClick={submit}
            disabled={disabled || value.trim().length === 0}
            className="mono text-2xs px-3 py-1.5 bg-accent text-raised rounded-md font-medium disabled:opacity-40 flex items-center gap-1.5"
          >
            <SendIcon size={11} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
