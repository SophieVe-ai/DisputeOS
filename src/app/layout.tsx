import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SystemBar } from "@/components/SystemBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "DisputeOS — autonomous dispute resolution",
  description: "Multi-agent B2B debt dispute resolution with a tamper-evident on-chain audit log and human approval.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-20 border-b border-line bg-panel-2/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-6 px-6 py-3">
            <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm">⚖</span>
              DisputeOS
            </Link>
            <nav aria-label="Main" className="flex gap-4 text-sm text-ink-2">
              <Link href="/" className="hover:text-ink">Cases</Link>
              <Link href="/cases/new" className="hover:text-ink">New case</Link>
              <Link href="/ledger" className="hover:text-ink">Audit ledger</Link>
            </nav>
            <div className="ml-auto"><SystemBar /></div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
