import Link from "next/link";

interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <div className="flex items-center gap-1.5 mb-4 text-xs">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {item.href ? (
            <Link href={item.href} className="text-text-secondary hover:text-text-primary">
              {item.label}
            </Link>
          ) : (
            <span className="text-text-primary font-medium">{item.label}</span>
          )}
          {i < items.length - 1 && <span className="text-text-muted">/</span>}
        </span>
      ))}
    </div>
  );
}
