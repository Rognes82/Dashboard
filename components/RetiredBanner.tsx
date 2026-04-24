import Link from "next/link";

export function RetiredBanner() {
  return (
    <div className="bg-hover border-b border-border-default px-6 py-2 text-2xs mono flex items-center justify-between">
      <span className="text-text-muted">This page is retired from the primary navigation.</span>
      <Link href="/" className="text-accent hover:opacity-80">Go to Chat →</Link>
    </div>
  );
}
