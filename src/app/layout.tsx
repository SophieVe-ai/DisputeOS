import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "@/components/Nav";
import { SystemBar } from "@/components/SystemBar";
import { Logo } from "@/components/ui/icons";
import "./globals.css";

export const metadata: Metadata = {
  title: "DisputeOS — autonomous dispute resolution",
  description: "Multi-agent B2B debt dispute resolution with a tamper-evident on-chain audit log and human approval.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <div aria-hidden className="backdrop" />
        <header className="sticky top-0 z-30 border-b border-line bg-bg/75 backdrop-blur-xl">
          <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-6 px-6">
            <Link href="/" className="flex items-center gap-2.5 text-ink">
              <Logo size={20} />
              <span className="text-[14px] font-semibold tracking-[-0.02em]">DisputeOS</span>
            </Link>
            <span aria-hidden className="h-4 w-px bg-line-2" />
            <Nav />
            <div className="ml-auto hidden md:block"><SystemBar /></div>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
