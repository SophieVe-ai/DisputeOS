"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface Envelope<T> { success: boolean; data: T | null; error: string | null }

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...init,
    // Let the browser set the multipart boundary for uploads.
    headers: isForm ? init?.headers : { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new Error(`Request failed (${res.status})`);
  }
  if (!res.ok || !body.success || body.data === null) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body.data;
}

/** Polls a JSON endpoint. Pauses while the tab is hidden. */
export function usePoll<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!url) return;
    try {
      const next = await api<T>(url);
      if (alive.current) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [url]);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return { data, error, refresh };
}

const APPROVER_KEY = "disputeos.approver";
const APPROVER_EVENT = "disputeos-approver";

function subscribeApprover(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(APPROVER_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(APPROVER_EVENT, cb);
  };
}

/** The approver's name, persisted in localStorage and shared across components. */
export function useApproverName(): [string, (name: string) => void] {
  const name = useSyncExternalStore(subscribeApprover, () => localStorage.getItem(APPROVER_KEY) ?? "", () => "");
  const setName = useCallback((next: string) => {
    localStorage.setItem(APPROVER_KEY, next);
    window.dispatchEvent(new Event(APPROVER_EVENT));
  }, []);
  return [name, setName];
}
