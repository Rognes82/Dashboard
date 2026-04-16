import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h2 className="mono text-lg font-semibold text-text-primary">Not found</h2>
      <p className="text-xs text-text-muted">
        The page or resource you were looking for could not be found.
      </p>
      <Link
        href="/"
        className="bg-accent-green/10 text-accent-green text-xs font-medium rounded px-3 py-1.5 hover:bg-accent-green/20 transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
