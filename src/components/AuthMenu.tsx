"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { notifyAuthChanged, useCurrentUser } from "./auth";

export function AuthMenu() {
  const user = useCurrentUser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await api("/api/auth/signout", { method: "POST", body: "{}" });
      notifyAuthChanged();
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  // Reserve the space while loading so the header doesn't jump.
  if (user === undefined) return <div className="h-8 w-[150px]" aria-hidden />;

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/signin" className="btn btn-ghost h-8 px-3">Sign in</Link>
        <Link href="/signup" className="btn btn-primary h-8 px-3">Sign up</Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-right leading-tight sm:block">
        <span className="block max-w-[180px] truncate text-[12.5px] text-ink">{user.businessName ?? user.email}</span>
        {user.businessName && <span className="block max-w-[180px] truncate font-mono text-[10.5px] text-ink-3">{user.email}</span>}
      </span>
      <button type="button" className="btn btn-ghost h-8 px-3" onClick={signOut} disabled={busy}>Sign out</button>
    </div>
  );
}
