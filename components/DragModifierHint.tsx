"use client";

import { useEffect, useState } from "react";
import { useIsDragging } from "@/lib/dnd";

export function DragModifierHint() {
  const dragging = useIsDragging();
  const [cmd, setCmd] = useState(false);

  useEffect(() => {
    if (!dragging) { setCmd(false); return; }
    function down(e: KeyboardEvent) { if (e.metaKey || e.ctrlKey) setCmd(true); }
    function up(e: KeyboardEvent) { if (!e.metaKey && !e.ctrlKey) setCmd(false); }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [dragging]);

  if (!dragging) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[75] font-mono text-xs px-2 py-1 bg-raised border border-border-default rounded-md text-text-secondary pointer-events-none">
      {cmd ? "Move (⌘)" : "Add"}
    </div>
  );
}
