"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ToastLevel = "info" | "warn" | "error";
interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
}
interface ToastContextValue {
  show: (message: string, level?: ToastLevel) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, level: ToastLevel = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, level, message }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((list) => list.slice(1)), 6000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="fixed bottom-4 right-4 flex flex-col gap-2 z-[70]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`mono text-2xs px-3 py-2 rounded-md border ${
              t.level === "error"
                ? "bg-raised border-red-400/50 text-red-400"
                : t.level === "warn"
                ? "bg-raised border-amber-400/40 text-amber-300"
                : "bg-raised border-border-default text-text-secondary"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
