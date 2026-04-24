"use client";

import { CloseIcon } from "../icons";

export function ScopeBadge({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-2 px-2 py-0.5 border border-accent bg-accent-tint rounded-sm">
      <span className="mono text-2xs text-accent">{label}</span>
      <button onClick={onClear} aria-label="clear scope" className="text-accent hover:text-text-primary">
        <CloseIcon size={10} />
      </button>
    </span>
  );
}
