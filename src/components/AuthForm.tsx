"use client";
import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="mx-auto max-w-md py-6">
      <div className="card p-7">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-sm text-ink-3">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
      <p className="mt-4 text-center text-sm text-ink-3">{footer}</p>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/** Validation errors arrive as "field: message; field: message"; show just the messages. */
export function friendlyError(message: string): string {
  return message
    .split("; ")
    .map((part) => part.replace(/^[\w.]+: /, ""))
    .join(" ");
}
