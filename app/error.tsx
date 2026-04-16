"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-start gap-3 max-w-lg">
      <h2 className="mono text-lg font-semibold text-text-primary">Something went wrong</h2>
      <p className="text-xs text-text-muted">
        An unexpected error occurred while rendering this page.
      </p>
      {error.message && (
        <pre className="mono text-[10px] text-accent-red bg-card border border-border rounded p-2 overflow-x-auto w-full">
          {error.message}
        </pre>
      )}
      <button
        onClick={() => reset()}
        className="bg-accent-green/10 text-accent-green text-xs font-medium rounded px-3 py-1.5 hover:bg-accent-green/20 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
