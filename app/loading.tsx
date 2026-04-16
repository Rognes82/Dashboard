export default function Loading() {
  return (
    <div className="flex items-center gap-2 text-xs text-text-muted">
      <div className="w-2 h-2 bg-accent-green rounded-full animate-pulse" />
      <span className="mono">Loading…</span>
    </div>
  );
}
