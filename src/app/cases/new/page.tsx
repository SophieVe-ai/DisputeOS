"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import { Analysing } from "@/components/intake/Analysing";
import { Dropzone } from "@/components/intake/Dropzone";
import { draftFrom, ReviewPanel, type CaseDraft } from "@/components/intake/ReviewPanel";
import { SAMPLES_ROOT, type IntakePreview, type PreviewDocument } from "@/components/intake/types";
import { Reveal } from "@/components/ui/motion";

type Stage = "select" | "analysing" | "review";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function loadSamplePack(slug: string): Promise<File[]> {
  const base = `${SAMPLES_ROOT}/${slug}`;
  const res = await fetch(`${base}/manifest.json`);
  if (!res.ok) throw new Error("Sample pack is unavailable");
  const { files } = (await res.json()) as { files: string[] };
  return Promise.all(
    files.map(async (name) => {
      const blob = await (await fetch(`${base}/${name}`)).blob();
      return new File([blob], name, { type: "text/plain" });
    }),
  );
}

export default function UploadCasePage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("select");
  const [files, setFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState<PreviewDocument[]>([]);
  const [draft, setDraft] = useState<CaseDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function analyse(selected: File[]) {
    setError(null);
    setFiles(selected);
    setStage("analysing");
    const form = new FormData();
    selected.forEach((f) => form.append("files", f));
    try {
      const [preview] = await Promise.all([
        api<IntakePreview>("/api/intake/preview", { method: "POST", body: form }),
        new Promise((r) => setTimeout(r, 1400)), // let the analysis animation read
      ]);
      setDocs(preview.documents);
      setError(preview.warning);
      setDraft(draftFrom(preview.inferred));
      setStage("review");
    } catch (err) {
      setError(errorText(err));
      setStage("select");
    }
  }

  async function loadSample(slug: string) {
    try {
      await analyse(await loadSamplePack(slug));
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function submit() {
    if (!draft) return;
    const claimed = Math.round(Number(draft.claimed.replace(/[£,\s]/g, "")) * 100);
    if (!Number.isFinite(claimed) || claimed <= 0) return setError("Enter the amount claimed in pounds.");
    if (!draft.creditor.trim() || !draft.debtor.trim()) return setError("Enter both the creditor and the debtor.");
    setError(null);
    try {
      setProgress("Opening case");
      const created = await api<{ id: string }>("/api/cases", {
        method: "POST",
        body: JSON.stringify({
          title: draft.title,
          creditor: draft.creditor,
          debtor: draft.debtor,
          debtorEmail: draft.debtorEmail || null,
          claimedAmountPence: claimed,
          summary: draft.summary,
          documents: docs.map(({ kind, title, content, docDate }) => ({ kind, title: title || kind, content, docDate })),
        }),
      });
      setProgress("Starting agents");
      const requestedBy = localStorage.getItem("disputeos.approver") || "operator";
      await api(`/api/cases/${created.id}/runs`, { method: "POST", body: JSON.stringify({ requestedBy }) });
      router.push(`/cases/${created.id}`);
    } catch (err) {
      setError(errorText(err));
      setProgress(null);
    }
  }

  return (
    <div className="space-y-10">
      <header className="border-b border-line pb-10">
        <div>
          <Reveal><span className="label">New case</span></Reveal>
          <Reveal delay={80}><h1 className="mt-3 text-[40px] font-normal leading-tight tracking-[-0.035em]">Upload a case file</h1></Reveal>
          <Reveal delay={160}>
            <p className="mt-4 max-w-xl text-[14px] leading-relaxed text-ink-2">
              Drop in whatever you have. DisputeOS reads each document, works out what it is, and infers who owes whom and how much.
              Check the details, then start the agents: you&apos;ll watch them work, and every step land on-chain, in real time.
            </p>
          </Reveal>
          <Reveal delay={240} className="mt-6 flex flex-wrap gap-6 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            {["01 Upload", "02 Review", "03 Agents run", "04 You approve"].map((s, i) => (
              <span key={s} className={i === (stage === "review" ? 1 : 0) ? "text-ink" : ""}>{s}</span>
            ))}
          </Reveal>
        </div>
      </header>

      {error && <p role="alert" className="reveal rounded border border-bad/40 bg-bad/[.05] px-4 py-3 text-[13px] text-bad">{error}</p>}

      {stage === "select" && <Reveal delay={300}><Dropzone onFiles={analyse} onSample={loadSample} busy={false} /></Reveal>}
      {stage === "analysing" && <Analysing files={files} />}
      {stage === "review" && draft && (
        <ReviewPanel
          docs={docs}
          draft={draft}
          onDraft={setDraft}
          onDoc={(i, patch) => setDocs(docs.map((d, n) => (n === i ? { ...d, ...patch } : d)))}
          onRemove={(i) => setDocs(docs.filter((_, n) => n !== i))}
          onReset={() => {
            setStage("select");
            setDocs([]);
            setDraft(null);
            setError(null);
          }}
          onSubmit={submit}
          submitting={progress !== null}
          progress={progress}
        />
      )}
    </div>
  );
}
