"use client";
import { useCallback, useEffect, useState } from "react";
import type { PublicUser } from "@/lib/api/account-view";
import { api } from "./api";

const AUTH_EVENT = "disputeos-auth";

/** Tell every mounted `useCurrentUser` to re-check the session (after sign in/up/out). */
export function notifyAuthChanged(): void {
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/** The signed-in user: `undefined` while loading, `null` when signed out. */
export function useCurrentUser(): PublicUser | null | undefined {
  const [user, setUser] = useState<PublicUser | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setUser((await api<{ user: PublicUser | null }>("/api/auth/me")).user);
    } catch {
      setUser(null);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    window.addEventListener(AUTH_EVENT, load);
    return () => {
      clearTimeout(first);
      window.removeEventListener(AUTH_EVENT, load);
    };
  }, [load]);
  return user;
}
