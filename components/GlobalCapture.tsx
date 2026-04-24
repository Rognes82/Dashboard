"use client";

import { useEffect, useState } from "react";
import { QuickCapture } from "./QuickCapture";

export function GlobalCapture() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return <QuickCapture open={open} onClose={() => setOpen(false)} />;
}
