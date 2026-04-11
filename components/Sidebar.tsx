"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Users, FolderGit2, Cpu, FileText, StickyNote, Settings, type LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/agents", label: "Agents", icon: Cpu },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/notes", label: "Notes", icon: StickyNote },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="group fixed top-0 left-0 h-screen w-14 hover:w-56 bg-card border-r border-border transition-all duration-200 ease-out overflow-hidden z-50 flex flex-col">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border flex items-center gap-2.5 whitespace-nowrap">
        <div className="w-6 h-6 bg-accent-green/15 rounded-md flex items-center justify-center shrink-0">
          <LayoutGrid size={14} className="text-accent-green" />
        </div>
        <span className="mono text-sm font-semibold text-text-primary opacity-0 group-hover:opacity-100 transition-opacity">
          Command Center
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 flex flex-col gap-0.5 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href !== "/" && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-2 py-2.5 rounded-md transition-colors whitespace-nowrap ${
                isActive
                  ? "bg-accent-green/10 text-accent-green"
                  : "text-text-secondary hover:bg-hover hover:text-text-primary"
              }`}
            >
              <div className="shrink-0 ml-1">
                <Icon size={16} />
              </div>
              <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                {item.label}
              </span>
            </Link>
          );
        })}
        <div className="flex-1" />
        <Link
          href="/settings"
          className={`flex items-center gap-2.5 px-2 py-2.5 rounded-md transition-colors whitespace-nowrap ${
            pathname === "/settings"
              ? "bg-accent-green/10 text-accent-green"
              : "text-text-secondary hover:bg-hover hover:text-text-primary"
          }`}
        >
          <div className="shrink-0 ml-1">
            <Settings size={16} />
          </div>
          <span className="text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            Settings
          </span>
        </Link>
      </nav>

      {/* Sync footer */}
      <div className="px-4 py-3 border-t border-border whitespace-nowrap">
        <div className="flex gap-1 group-hover:justify-start justify-center">
          <div className="w-1.5 h-1.5 bg-accent-green rounded-full" />
          <div className="w-1.5 h-1.5 bg-accent-green rounded-full" />
          <div className="w-1.5 h-1.5 bg-accent-amber rounded-full" />
          <div className="w-1.5 h-1.5 bg-accent-green rounded-full" />
        </div>
        <div className="mono text-text-muted text-[9px] mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          Synced 2m ago
        </div>
      </div>
    </aside>
  );
}
