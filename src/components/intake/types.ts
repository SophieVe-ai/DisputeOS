import type { DocKind } from "@/lib/types";

export interface PreviewDocument {
  filename: string;
  kind: DocKind;
  title: string;
  docDate: string | null;
  content: string;
  confidence: number;
  truncated: boolean;
  /** "claude" when the rules couldn't classify it and Claude did. */
  readBy: "rules" | "claude";
}

export interface InferredCase {
  title: string;
  creditor: string;
  debtor: string;
  debtorEmail: string | null;
  claimedAmountPence: number | null;
  summary: string;
}

export interface IntakePreview {
  documents: PreviewDocument[];
  inferred: InferredCase;
  warning: string | null;
}

export const ACCEPT = ".txt,.md,.eml,.csv,.pdf";
export const SAMPLES_ROOT = "/samples";

export interface SamplePack {
  slug: string;
  name: string;
  description: string;
  documents: number;
}
