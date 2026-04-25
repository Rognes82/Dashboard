"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode, MouseEvent } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface OpenState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuContextValue {
  open(e: MouseEvent | { clientX: number; clientY: number; preventDefault: () => void }, items: ContextMenuItem[]): void;
  close(): void;
}

const Ctx = createContext<ContextMenuContextValue | null>(null);

export function useContextMenu(): ContextMenuContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useContextMenu must be inside <ContextMenuProvider>");
  return v;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  function open(
    e: MouseEvent | { clientX: number; clientY: number; preventDefault: () => void },
    items: ContextMenuItem[]
  ) {
    e.preventDefault();
    setState({ x: e.clientX, y: e.clientY, items });
  }

  function close() {
    setState(null);
  }

  useEffect(() => {
    if (!state) return;
    function onDocClick(ev: globalThis.MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) close();
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [state]);

  // Position clamp: shift left/up if menu would overflow viewport
  const root = typeof document !== "undefined" ? document.getElementById("context-menu-root") : null;
  const menu = state && root ? (
    <div
      ref={menuRef}
      style={{ left: clampX(state.x), top: clampY(state.y) }}
      className="fixed z-[80] min-w-[160px] bg-raised border border-border-default rounded-md shadow-xl py-1"
    >
      {state.items.map((item, i) => (
        <button
          key={i}
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.action();
            close();
          }}
          className={[
            "w-full text-left px-3 py-1.5 font-mono uppercase tracking-wide text-xs",
            item.disabled
              ? "text-text-tertiary cursor-not-allowed"
              : item.danger
              ? "text-red-400 hover:bg-red-500/10"
              : "text-text-primary hover:bg-base",
          ].join(" ")}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <Ctx.Provider value={{ open, close }}>
      {children}
      {menu && root ? createPortal(menu, root) : null}
    </Ctx.Provider>
  );
}

function clampX(x: number) {
  if (typeof window === "undefined") return x;
  const menuWidth = 200;
  return Math.min(x, window.innerWidth - menuWidth - 8);
}
function clampY(y: number) {
  if (typeof window === "undefined") return y;
  const menuHeightEstimate = 220;
  return Math.min(y, window.innerHeight - menuHeightEstimate - 8);
}
