// Gold-labelled evaluation scenarios. Expected values are derived by hand from the
// contract terms, delivery records and statute — not from the agents' own output —
// so the eval measures whether the agents reach the legally correct answer.
import fs from "node:fs";
import path from "node:path";
import { classifyDocument, inferCase } from "../intake/classify";
import { extractFile } from "../intake/extract";
import type { NewCaseInput } from "../repo/cases";
import { FIXTURE_CASES } from "../fixtures/cases";
import type { ChallengeVerdict, DocKind, ProposalKind, Recommendation } from "../types";

export interface ExpectedOutcome {
  /** Upload scenarios only: the correct kind for each document, in upload order. */
  documentKinds?: DocKind[];
  supportedPrincipalPence: number;
  defensiblePrincipalPence: number;
  recommendation: Recommendation;
  daysOverdue: number;
  /** Matched against challenge titles (case-insensitive substring). */
  verdicts: { titleIncludes: string; verdict: ChallengeVerdict }[];
  proposalKinds: ProposalKind[];
}

export interface Scenario {
  id: string;
  name: string;
  tests: string;
  source: "seed" | "upload";
  load(): Promise<NewCaseInput & { id: string }>;
  expected: ExpectedOutcome;
}

export const EVAL_AS_OF = "2026-10-15";

const fixture = (id: string) => async () => {
  const found = FIXTURE_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`Seed case ${id} missing`);
  return found;
};

const SAMPLE_DIR = path.join(process.cwd(), "public", "samples", "meridian");

/** Runs the sample pack through the same intake path as a browser upload. */
async function loadUploadPack(): Promise<NewCaseInput & { id: string }> {
  const manifest = JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, "manifest.json"), "utf8")) as { files: string[] };
  const files = await Promise.all(manifest.files.map((f) => extractFile(f, new Uint8Array(fs.readFileSync(path.join(SAMPLE_DIR, f))))));
  const docs = files.map((f) => classifyDocument(f.filename, f.text));
  const meta = inferCase(docs);
  return {
    id: "eval-meridian-upload",
    reference: "EVAL-UPLOAD",
    ...meta,
    claimedAmountPence: meta.claimedAmountPence ?? 0,
    documents: docs.map(({ kind, title, content, docDate }) => ({ kind, title, content, docDate })),
  };
}

const STATUTE_BARRED: NewCaseInput & { id: string } = {
  id: "eval-statute-barred",
  reference: "EVAL-LIMITATION",
  title: "Shopfront signage — Castle Retail",
  creditor: "Harrow Signage Ltd",
  debtor: "Castle Retail Ltd",
  debtorEmail: null,
  claimedAmountPence: 420_000,
  summary: "£4,200 invoice from 2019 that was never chased.",
  documents: [
    { kind: "contract", title: "Order HS-2019-14", docDate: "2019-04-20", content: "SIGNAGE ORDER\nContract reference: HS-2019-14\nContract date: 2019-04-20\nSupplier: Harrow Signage Ltd\nCustomer: Castle Retail Ltd\nPayment terms: 30 days from invoice\n- Illuminated fascia sign | qty 2 | £2,100.00 per unit" },
    { kind: "delivery_note", title: "Installation sign-off", docDate: "2019-05-08", content: "INSTALLATION SIGN-OFF\nDelivery date: 2019-05-08\n- Illuminated fascia sign | qty 2\nSigned by: T. Avery (Store Manager, Castle Retail)" },
    { kind: "invoice", title: "Invoice HS-881", docDate: "2019-05-10", content: "INVOICE\nInvoice number: HS-881\nInvoice date: 2019-05-10\nDue date: 2019-06-09\n- Illuminated fascia sign | qty 2 | £2,100.00\nTotal due: £4,200.00" },
  ],
};

export const SCENARIOS: Scenario[] = [
  {
    id: "harbour-kestrel",
    name: "Kitchen units — partial damage defence",
    tests: "Upholds a damage claim inside the inspection window, rebuts a late quality complaint",
    source: "seed",
    load: fixture("case-harbour-kestrel"),
    expected: {
      supportedPrincipalPence: 1_292_000,
      defensiblePrincipalPence: 1_176_500, // 3 damaged units × £385 deducted
      recommendation: "pursue_reduced",
      daysOverdue: 102,
      verdicts: [
        { titleIncludes: "damaged", verdict: "upheld" },
        { titleIncludes: "poor quality", verdict: "rebutted" },
      ],
      proposalKinds: ["send_letter_before_action", "offer_settlement", "prepare_court_claim"],
    },
  },
  {
    id: "northbank-lumen",
    name: "Print run — clean overdue debt",
    tests: "Pursues an undisputed, delivered and signed-for debt in full",
    source: "seed",
    load: fixture("case-northbank-lumen"),
    expected: {
      supportedPrincipalPence: 675_000,
      defensiblePrincipalPence: 675_000,
      recommendation: "pursue_full",
      daysOverdue: 87,
      verdicts: [],
      proposalKinds: ["send_letter_before_action", "prepare_court_claim"],
    },
  },
  {
    id: "peak-ashford",
    name: "Catering — our own overcharge",
    tests: "Catches the creditor's overcharge and short delivery and credits them first",
    source: "seed",
    load: fixture("case-peak-ashford"),
    expected: {
      supportedPrincipalPence: 892_600,
      defensiblePrincipalPence: 892_600,
      recommendation: "pursue_reduced",
      daysOverdue: 49,
      verdicts: [
        { titleIncludes: "pricing", verdict: "upheld" }, // £4.20 invoiced vs £3.95 contract
        { titleIncludes: "short delivery", verdict: "upheld" }, // 36 of 40 cases delivered
      ],
      proposalKinds: ["issue_credit_note", "send_letter_before_action", "offer_settlement"],
    },
  },
  {
    id: "meridian-upload",
    name: "Office fit-out — uploaded documents",
    tests: "Classifies raw uploads, credits a real shortfall, rebuts a baseless pricing complaint, holds off court at 57 days",
    source: "upload",
    load: loadUploadPack,
    expected: {
      documentKinds: ["contract", "delivery_note", "invoice", "correspondence", "payment", "correspondence", "correspondence"],
      supportedPrincipalPence: 568_000, // £11,160 − £5,000 paid − 2 chairs × £240 not delivered
      defensiblePrincipalPence: 568_000,
      recommendation: "pursue_reduced",
      daysOverdue: 57,
      verdicts: [
        { titleIncludes: "short delivery", verdict: "upheld" },
        { titleIncludes: "pricing", verdict: "rebutted" },
      ],
      proposalKinds: ["issue_credit_note", "send_letter_before_action", "offer_settlement"],
    },
  },
  {
    id: "statute-barred",
    name: "Signage — statute-barred debt",
    tests: "Recognises a debt over six years old under the Limitation Act 1980 and recommends write-off",
    source: "seed",
    load: async () => STATUTE_BARRED,
    expected: {
      supportedPrincipalPence: 420_000,
      defensiblePrincipalPence: 0,
      recommendation: "write_off",
      daysOverdue: 2685,
      verdicts: [{ titleIncludes: "statute-barred", verdict: "upheld" }],
      proposalKinds: ["write_off"],
    },
  },
];
