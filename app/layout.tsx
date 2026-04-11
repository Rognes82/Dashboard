import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Command Center",
  description: "Unified dashboard for clients, agents, and system health",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Sidebar />
        <main className="ml-14 min-h-screen p-6">{children}</main>
      </body>
    </html>
  );
}
