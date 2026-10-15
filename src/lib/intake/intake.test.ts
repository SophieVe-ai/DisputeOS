import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDocument, classifyKind, inferCase } from "./classify";
import { extractFile, IntakeError, MAX_FILE_BYTES, normaliseEmail } from "./extract";

const SAMPLE_DIR = path.join(process.cwd(), "public", "samples", "meridian");
const sampleFiles = (JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, "manifest.json"), "utf8")) as { files: string[] }).files;
const enc = (s: string) => new TextEncoder().encode(s);

async function loadSamplePack() {
  const extracted = await Promise.all(sampleFiles.map((f) => extractFile(f, new Uint8Array(fs.readFileSync(path.join(SAMPLE_DIR, f))))));
  return extracted.map((e) => classifyDocument(e.filename, e.text));
}

describe("extractFile", () => {
  it("rejects unsupported, empty and oversized files", async () => {
    await expect(extractFile("photo.png", enc("x"))).rejects.toThrow(IntakeError);
    await expect(extractFile("notes.txt", new Uint8Array())).rejects.toThrow(/empty/);
    await expect(extractFile("big.txt", new Uint8Array(MAX_FILE_BYTES + 1))).rejects.toThrow(/larger than/);
  });

  it("reports unreadable PDFs as intake errors", async () => {
    await expect(extractFile("broken.pdf", enc("not really a pdf"))).rejects.toThrow(IntakeError);
  });

  it("normalises CRLF and truncates very long text", async () => {
    const out = await extractFile("long.txt", enc(`a\r\nb${"x".repeat(25_000)}`));
    expect(out.text.startsWith("a\nb")).toBe(true);
    expect(out.truncated).toBe(true);
    expect(out.text).toHaveLength(20_000);
  });

  it("keeps only evidential email headers and converts RFC dates to ISO", () => {
    const out = normaliseEmail("From: A <a@x.example>\nReceived: by mx\nDate: Tue, 21 Jul 2026 09:14:00 +0100\nSubject: Hi\n\nBody text.");
    expect(out).toBe("From: A <a@x.example>\nDate: 2026-07-21\nSubject: Hi\n\nBody text.");
  });
});

describe("classification", () => {
  it("classifies every document in the sample pack", async () => {
    const docs = await loadSamplePack();
    expect(docs.map((d) => d.kind)).toEqual(["contract", "delivery_note", "invoice", "correspondence", "payment", "correspondence", "correspondence"]);
    expect(docs.every((d) => d.confidence >= 0.55)).toBe(true);
  });

  it("derives titles and dates from document fields", async () => {
    const docs = await loadSamplePack();
    expect(docs[0]).toMatchObject({ title: "Contract AOI-ML-2026-07", docDate: "2026-07-01" });
    expect(docs[1]).toMatchObject({ title: "Delivery note DN-8804", docDate: "2026-07-18" });
    expect(docs[2]).toMatchObject({ title: "Invoice AOI-3317", docDate: "2026-07-20" });
    expect(docs[4]).toMatchObject({ title: "Remittance advice", docDate: "2026-08-25" });
    expect(docs[3]).toMatchObject({ title: "Delivery DN-8804 - missing chairs — Lauren Grant", docDate: "2026-07-21" });
  });

  it("falls back to 'other' and a cleaned filename when nothing matches", () => {
    expect(classifyKind("misc.txt", "lorem ipsum").kind).toBe("other");
    expect(classifyDocument("09_site-photos_notes.txt", "lorem ipsum").title).toBe("Site photos notes");
  });

  it("infers parties and the outstanding balance", async () => {
    const meta = inferCase(await loadSamplePack());
    expect(meta).toMatchObject({
      creditor: "Atlas Office Interiors Ltd",
      debtor: "Meridian Lettings Ltd",
      debtorEmail: "l.grant@meridian-lettings.example",
      claimedAmountPence: 616_000,
      title: "Task chair — Meridian Lettings",
    });
    expect(meta.summary).toContain("£6,160.00");
  });
});

describe("sample packs", () => {
  const ROOT = path.join(process.cwd(), "public", "samples");
  const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "index.json"), "utf8")) as { slug: string; documents: number }[];

  it.each(packs.filter((p) => p.slug !== "meridian").map((p) => p.slug))("%s pack classifies like its fixture and infers its balance", async (slug) => {
    const { FIXTURE_CASES } = await import("../fixtures/cases");
    const fixture = FIXTURE_CASES.find((c) => c.id.endsWith(`-${slug}`))!;
    const { files } = JSON.parse(fs.readFileSync(path.join(ROOT, slug, "manifest.json"), "utf8")) as { files: string[] };
    const docs = await Promise.all(
      files.map(async (f) => {
        const e = await extractFile(f, new Uint8Array(fs.readFileSync(path.join(ROOT, slug, f))));
        return classifyDocument(e.filename, e.text);
      }),
    );
    expect(docs.map((d) => d.kind)).toEqual(fixture.documents.map((d) => d.kind));
    const meta = inferCase(docs);
    expect(meta.creditor).toBe(fixture.creditor);
    expect(meta.debtor).toBe(fixture.debtor);
    expect(meta.claimedAmountPence).toBe(fixture.claimedAmountPence);
  });
});
