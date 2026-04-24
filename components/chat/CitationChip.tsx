"use client";

import { ExternalIcon } from "../icons";

interface Props {
  vault_path: string;
  onClick: () => void;
}

export function CitationChip({ vault_path, onClick }: Props) {
  const filename = vault_path.split("/").pop() ?? vault_path;
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2 py-1 border border-border-default rounded-sm mono text-2xs text-accent hover:bg-hover"
    >
      <ExternalIcon size={10} />
      {filename}
    </button>
  );
}
