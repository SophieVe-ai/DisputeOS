---
title: DisputeOS reference case dataset (Inputs) documentation spec
labels: [ready-for-doc]
project: DisputeOS
vocabulary: "[DisputeOS/docs/glossary.md](../docs/glossary.md)"
date: 2026-10-15
---

# DisputeOS_DTSO: Reference case dataset

## Problem Statement

DisputeOS reasons about invoice disputes, but everything it has been shown is fictional: the three seeded demo cases in [DisputeOS/src/lib/seed-data.ts](../src/lib/seed-data.ts). There is now a folder of 22 real, fully resolved London judgments in [DisputeOS/Inputs](README.md), each with a judgment PDF and a commentary. Nothing yet tells a reader:

- what the dataset is for, and what it is not (it is not legal advice and not training data);
- how a commentary's **Inputs** map onto a DisputeOS **case** and its **documents** (`DocKind`);
- how a commentary's **Outcome** maps onto what the agents should produce: **verdicts** (`ChallengeVerdict`), **defensible principal**, **statutory interest**, **proposal kinds** (`ProposalKind`);
- how the cases were selected, how reliable the figures are, and how to add or correct a case;
- which terms are used, and where they are defined.

Without this, contributors will read the commentaries inconsistently, extend the dataset with cases that do not meet the selection tests, and have no shared benchmark for agent behaviour.

## Solution

A small, layered documentation set around the dataset, using the vocabulary in [DisputeOS/docs/glossary.md](../docs/glossary.md):

1. **Dataset index:** [DisputeOS/Inputs/README.md](README.md) (exists). Selection method, tiers, one-row summary per case, exclusions.
2. **Per-case commentary:** `commentary.md` in every case folder (exists), in a fixed template: Inputs, Outcome, Commentary.
3. **Commentary template and contributor guide:** a new `Inputs/CONTRIBUTING.md`. The template, the two selection tests, sourcing rules and the review checklist.
4. **Mapping guide:** a new `docs/reference-cases.md`. How commentary sections map onto DisputeOS types and agents, with one fully worked example (Pharos Offshore v Keynvor Morlift) and how to use the dataset to judge agent output.
5. **Glossary:** [DisputeOS/docs/glossary.md](../docs/glossary.md) (exists). The single source for terms. Other docs link to it rather than redefining terms.

A reader should be able to open any case, understand what the court decided, and say what DisputeOS should have done with the same facts.

## Documentation Requirements

1. **Structure.** Index → per-case commentary → mapping guide → glossary. Each layer links to the next. The index is the entry point from the root [DisputeOS/README.md](../README.md), which gains one line pointing to it.
2. **Audience.**
   - Primary: developers and prompt authors tuning the Evidence, Challenge and Resolution agents.
   - Secondary: demo presenters and judges wanting real-world grounding; collections staff reading commentary for lessons.
   - Not lawyers: commentary is explanatory, not advice.
3. **Tone.** British English, plain and factual. Facts carry paragraph citations (`[para 42]`). Opinion appears only in the **Commentary** section and is labelled. No em dashes outside H1 titles (existing commentaries follow this).
4. **Reference sources.**
   - Judgments: The National Archives, Find Case Law (Open Justice Licence), stored as `judgment.pdf` alongside each commentary.
   - Statute: Late Payment of Commercial Debts (Interest) Act 1998, Limitation Act 1980, Senior Courts Act 1981 s.35A, Practice Direction on Pre-Action Conduct.
   - Code: [DisputeOS/src/lib/types.ts](../src/lib/types.ts), [DisputeOS/src/lib/agents/challenge.ts](../src/lib/agents/challenge.ts), [DisputeOS/src/lib/agents/resolution.ts](../src/lib/agents/resolution.ts), [DisputeOS/src/lib/interest.ts](../src/lib/interest.ts).
5. **Code examples.** The mapping guide includes one `NewCaseInput` object (TypeScript, matching [DisputeOS/src/lib/repo/cases.ts](../src/lib/repo/cases.ts)) built from a reference case's Inputs table, using the same `key: value` and `- item | qty N | £price` lines the offline parser expects ([DisputeOS/src/lib/parser.ts](../src/lib/parser.ts)). Figures must come from the judgment.
6. **Contracts (interfaces).** The commentary template is a contract. Fixed headings, in order:
   - `# <case name> — <neutral citation>`
   - metadata bullets: Court / venue, Judge, Hearing / hand-down, Source, Tier
   - `## Inputs` → `### Parties`, `### Documents in evidence` (table: DisputeOS kind, Document, Date, Key content), `### Amounts`, `### Debtor's defences and complaints`
   - `## Outcome` → `### Decision on each defence` (Upheld / Rejected / Partly upheld), `### Money result`
   - `## Commentary`

   The mapping guide states the correspondence: Upheld → `upheld`, Partly upheld → `partially_upheld`, Rejected → `rebutted`; Money result → `defensiblePrincipalPence` and `totalRecoverablePence`; court outcome → expected `ProposalKind`.
7. **Decision log.** Record in `Inputs/CONTRIBUTING.md`:
   - D1: London venue only (four non-London cases moved to `excluded-non-london/`, not deleted).
   - D2: "Fully resolved" allows interest arithmetic, costs and the form of order to remain open.
   - D3: Borderline tier kept rather than discarded, with the caveat on the Tier line.
   - D4: Commentaries are AI-drafted from the full judgment text and must be human-checked before use as a benchmark.
   - D5: Appeals after the listed judgments were not checked.
8. **Out-of-scope exclusions.** Stated in each doc's opening: not legal advice; no guarantee of later appeal outcomes; figures in foreign currency are not converted.

## Implementation Decisions

- **Docs to build:** `Inputs/CONTRIBUTING.md` (template, selection tests, decision log, review checklist) and `docs/reference-cases.md` (mapping guide and worked example).
- **Docs to modify:** root README (one link to the dataset index); [DisputeOS/Inputs/README.md](README.md) (link to the contributor guide and glossary; add a "Verified by / date" column once human review is done).
- **Seams (documentation coverage points).**
  1. *Document kind seam* (existing): the Inputs "Documents in evidence" table ↔ `DocKind` in [DisputeOS/src/lib/types.ts](../src/lib/types.ts). Every row must use one of the six kinds.
  2. *Verdict seam* (existing): Outcome "Decision on each defence" ↔ `ChallengeVerdict` and `DisputeType`.
  3. *Money seam* (existing): Outcome "Money result" ↔ `ReconciliationOutput` / `ChallengeOutput` totals and [DisputeOS/src/lib/interest.ts](../src/lib/interest.ts) (statutory interest, fixed compensation).
  4. *Action seam* (existing): court outcome ↔ `ProposalKind` (for example, creditor at fault → `issue_credit_note`; partial defence → `offer_settlement`; clean debt → `send_letter_before_action` + `prepare_court_claim`).
  5. *Proposed, highest-level seam:* a machine-readable `case.json` beside each commentary (the `NewCaseInput` shape plus an `expected` block: verdicts, defensible principal, proposal kinds). This would let a future evaluation script run the pipeline on a reference case and compare. Documented as a proposal only; building it is out of scope for this spec.
- **Vocabulary terms** used verbatim from the glossary: case, creditor, debtor, document kind, supported principal, defensible principal, statutory interest, fixed compensation, set-off, counterclaim, verdict, proposal, approval gate, reference case, core, borderline, fully resolved, creditor at fault.
- **Style choices.** Money in commentaries is written as in the judgment (currency symbol, two decimals); the mapping guide converts to pence only inside code examples. Case folders are named `<year>-<court-citation>-<short-parties>` in lowercase kebab case.

## Verification / Testing Decisions

- **Accuracy against source.** For every commentary, a reviewer checks each figure and each verdict against the cited paragraph of `judgment.pdf`. One case (Pharos Offshore) has been spot-checked. The remaining 21 need review. Track this in the index.
- **Accuracy against code.** Every DisputeOS kind, verdict and proposal kind named in a commentary or in the mapping guide must exist in [DisputeOS/src/lib/types.ts](../src/lib/types.ts). A simple grep check can enforce this.
- **Completeness.** Every case folder has exactly `judgment.pdf` and `commentary.md`, and every heading from Requirement 6 is present. Every case in the index links to an existing folder and vice versa.
- **Glossary consistency.** Terms in bold in any dataset doc appear in [DisputeOS/docs/glossary.md](../docs/glossary.md). No doc redefines a glossary term.
- **Readability.** A developer unfamiliar with English law can read one commentary and the mapping guide and correctly state the expected verdicts and proposal kinds for that case (a reviewer tests this on two cases).
- **Licence.** The index states the Open Justice Licence attribution for the judgment PDFs.

## Out of Scope

- Changing agent logic, prompts or seed data to match the reference cases.
- Building the `case.json` files or an evaluation harness (proposed seam only).
- Checking appeals or later history of any case.
- Cases outside London, outside England and Wales, or not fully resolved (including the 56 reviewed and rejected judgments).
- Legal advice, and any claim that DisputeOS output would match a court.
- Publishing the dataset outside the repository.

## Further Notes

- **Dataset size:** 22 cases (15 core, 7 borderline), from 244 search hits and 81 reviewed judgments; 4 non-London cases kept in `excluded-non-london/`.
- **Closest analogues to the demo:** International Media Advertising v Turkey (creditor at fault, like the Ashford Hotel demo case) and Pharos Offshore v Keynvor Morlift (partly upheld defect complaint set off against unpaid invoices, like the Kestrel demo case).
- **Known data caveats** flagged by commentary authors: several judgments state two different figures for the same sum or leave the net figure unstated. Commentaries record both and label any arithmetic of their own.
- **Interest rate:** the code default `BOE_BASE_RATE=4.0` must be checked against the current Bank of England rate before reference-case interest comparisons are made.
- This spec was synthesised from the code, the dataset and the session's research, without an interview.
