"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Cases", match: (p: string) => p === "/" || (p.startsWith("/cases/") && p !== "/cases/new") },
  { href: "/cases/new", label: "Upload", match: (p: string) => p === "/cases/new" },
  { href: "/evals", label: "Evals", match: (p: string) => p.startsWith("/evals") },
  { href: "/ledger", label: "Ledger", match: (p: string) => p.startsWith("/ledger") },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {LINKS.map((l) => {
        const active = l.match(pathname);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative rounded px-3 py-1.5 text-[13px] transition-colors ${active ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
          >
            {l.label}
            <span aria-hidden className={`absolute inset-x-3 -bottom-[13px] h-px bg-ink transition-opacity duration-300 ${active ? "opacity-100" : "opacity-0"}`} />
          </Link>
        );
      })}
    </nav>
  );
}
