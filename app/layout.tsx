"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { GlobalCapture } from "@/components/GlobalCapture";
import { ToastProvider } from "@/components/chat/ToastProvider";
import { ContextMenuProvider } from "@/components/ContextMenu";
import { DragModifierHint } from "@/components/DragModifierHint";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);

  return (
    <html lang="en">
      <head>
        <title>Command Center</title>
      </head>
      <body>
        <ToastProvider>
          <ContextMenuProvider>
            <Sidebar selectedBinId={selectedBinId} onSelectBin={setSelectedBinId} />
            <GlobalCapture />
            <main className="ml-[220px] min-h-screen bg-base" data-selected-bin={selectedBinId ?? ""}>
              {children}
            </main>
            <DragModifierHint />
            <div id="context-menu-root" />
          </ContextMenuProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
