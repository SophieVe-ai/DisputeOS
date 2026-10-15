"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { notifyAuthChanged } from "@/components/auth";
import { AuthCard, Field, friendlyError } from "@/components/AuthForm";

type AccountType = "business" | "other";

const TYPES: { value: AccountType; title: string; description: string }[] = [
  { value: "business", title: "Business", description: "I'm signing up on behalf of a company" },
  { value: "other", title: "Other", description: "Individual, adviser or anyone else" },
];

export default function SignUpPage() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accountType) return;
    setBusy(true);
    setError(null);
    try {
      const body = accountType === "business" ? { accountType, businessName, email, password } : { accountType, email, password };
      await api("/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
      notifyAuthChanged();
      router.push("/");
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  }

  const isBusiness = accountType === "business";

  return (
    <AuthCard
      title="Create your account"
      subtitle="Tell us who you are signing up as."
      footer={<>Already have an account? <Link href="/signin" className="text-ink underline-offset-4 hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <fieldset>
          <legend className="label">I am signing up as</legend>
          <div role="radiogroup" className="mt-2 grid grid-cols-2 gap-3">
            {TYPES.map((t) => {
              const selected = accountType === t.value;
              return (
                <label
                  key={t.value}
                  className={`cursor-pointer rounded border p-3 transition-colors ${selected ? "border-ink bg-panel-2" : "border-line hover:border-line-2"}`}
                >
                  <input type="radio" name="accountType" value={t.value} checked={selected} onChange={() => setAccountType(t.value)} className="sr-only" />
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    <span aria-hidden className={`h-3 w-3 rounded-full border ${selected ? "border-ink bg-ink" : "border-line-2"}`} />
                    {t.title}
                  </span>
                  <span className="mt-1 block text-xs text-ink-3">{t.description}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {accountType && (
          <div className="space-y-4">
            {isBusiness && (
              <Field label="Business name">
                <input className="input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} autoComplete="organization" required maxLength={140} placeholder="e.g. Northbank Print Co" />
              </Field>
            )}
            <Field label={isBusiness ? "Business email" : "Email"} hint={isBusiness ? "Use your work address — personal addresses like Gmail aren't accepted." : undefined}>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={200} placeholder={isBusiness ? "you@yourcompany.co.uk" : "you@example.com"} />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} maxLength={200} />
            </Field>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy || !email || !password || (isBusiness && !businessName)}>
              {busy ? "Creating account…" : "Create account"}
            </button>
          </div>
        )}
      </form>
    </AuthCard>
  );
}
