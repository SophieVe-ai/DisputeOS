"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { notifyAuthChanged } from "@/components/auth";
import { AuthCard, Field, friendlyError } from "@/components/AuthForm";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/signin", { method: "POST", body: JSON.stringify({ email, password }) });
      notifyAuthChanged();
      router.push("/");
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Welcome back to DisputeOS."
      footer={<>New here? <Link href="/signup" className="text-ink underline-offset-4 hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={200} autoFocus />
        </Field>
        <Field label="Password">
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={200} />
        </Field>
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <button type="submit" className="btn btn-primary w-full" disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}
