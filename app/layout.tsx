"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { GlobalCapture } from "@/components/GlobalCapture";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);

  return (
    <html lang="en">
      <head>
        <title>Command Center</title>
      </head>
      <body>
        <Sidebar selectedBinId={selectedBinId} onSelectBin={setSelectedBinId} />
        <GlobalCapture />
        <main className="ml-[220px] min-h-screen bg-base" data-selected-bin={selectedBinId ?? ""}>
          {children}
        </main>
      </body>
    </html>
  );
}
