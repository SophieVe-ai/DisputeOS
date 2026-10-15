---
title: DisputeOS reference case dataset (Inputs) documentation spec
labels: [ready-for-doc]
project: DisputeOS
vocabulary: "[DisputeOS/docs/glossary.md](../docs/glossary.md)"
date: 2026-10-15
revision: 2 (adds reconstructed document packs; aligns with the eval harness and upload-first demo)
---

# DisputeOS_DTSO: Reference case dataset

## Problem Statement

DisputeOS reasons about invoice disputes, but everything it is tested on is fictional: the fixture cases in [DisputeOS/src/lib/fixtures/cases.ts](../src/lib/fixtures/cases.ts), the upload sample packs in [DisputeOS/public/samples](../public/samples) and the gold-labelled scenarios in [DisputeOS/src/lib/eval/scenarios.ts](../src/lib/eval/scenarios.ts).

[DisputeOS/Inputs](README.md) now holds 22 real, fully resolved London judgments on unpaid invoices. Each case has the judgment PDF, a commentary, and a **document pack** of **reconstructed documents** (220 files in total) in the same upload format as the sample packs. Nothing yet tells a reader:

- what the dataset is for, and what it is not (not legal advice, not training data, not original documents);
- how a commentary's **Inputs** and a case's document pack map onto a DisputeOS **case** and its **document kinds** (`DocKind`);
- how a commentary's **Outcome** maps onto what the agents should produce: **verdicts** (`ChallengeVerdict`), **defensible principal**, **statutory interest**, **proposal kinds** (`ProposalKind`), and so onto the eval harness's `ExpectedOutcome`;
- the rules a reconstructed document must follow (faithfulness, **reconstruction footer**, format), and its known limits in the app;
- how the cases were selected, how reliable the figures are, and how to add or correct a case or a pack;
- which terms are used, and where they are defined.

Without this, contributors will read the commentaries inconsistently, mistake reconstructions for originals, add packs that invent facts, and have no shared way to judge agent behaviour against real outcomes.

## Solution

A small, layered documentation set around the dataset, using the vocabulary in [DisputeOS/docs/glossary.md](../docs/glossary.md):

1. **Dataset index:** [DisputeOS/Inputs/README.md](README.md) (exists). Selection method, tiers, one-row summary per case, the document-pack rules and app limitations, and exclusions.
2. **Per-case commentary:** `commentary.md` in every case folder (exists), in a fixed template: Inputs, Outcome, Commentary.
3. **Per-case document pack:** `documents/` in every London case folder (exists): numbered `.txt` / `.eml` files plus `manifest.json`, uploadable into the app.
4. **Contributor guide:** a new `Inputs/CONTRIBUTING.md`. The commentary template, the reconstruction rules, the two selection tests, the decision log and the review checklist.
5. **Mapping guide:** a new `docs/reference-cases.md`. How commentary and pack map onto DisputeOS types, agents and the eval harness, with one fully worked example (Pharos Offshore v Keynvor Morlift): upload the pack, run the agents, compare with the court.
6. **Glossary:** [DisputeOS/docs/glossary.md](../docs/glossary.md) (exists, extended). The single source for terms. Other docs link to it rather than redefining terms.

A reader should be able to open any case, understand what the court decided, upload the pack into DisputeOS, and say whether the agents reached a comparable result.

## Documentation Requirements

1. **Structure.** Index → per-case commentary and document pack → mapping guide → glossary. Each layer links to the next. The index is the entry point from the root [DisputeOS/README.md](../README.md), which gains one line pointing to it.
2. **Audience.**
   - Primary: developers and prompt authors tuning the Evidence, Challenge and Resolution agents and the intake classifier, and maintainers of the eval harness.
   - Secondary: demo presenters and judges wanting real-world grounding; collections staff reading commentary for lessons.
   - Not lawyers: commentary and packs are explanatory, not advice.
3. **Tone.** British English, plain and factual. Commentary facts carry paragraph citations (`[para 42]`). Opinion appears only in the commentary's **Commentary** section and is labelled. No em dashes outside commentary H1 titles.
4. **Reference sources.**
   - Judgments: The National Archives, Find Case Law (Open Justice Licence), stored as `judgment.pdf` in each case folder.
   - Statute: Late Payment of Commercial Debts (Interest) Act 1998, Limitation Act 1980, Senior Courts Act 1981 s.35A, Practice Direction on Pre-Action Conduct.
   - Code: [DisputeOS/src/lib/types.ts](../src/lib/types.ts), [DisputeOS/src/lib/intake/classify.ts](../src/lib/intake/classify.ts), [DisputeOS/src/lib/parser.ts](../src/lib/parser.ts), [DisputeOS/src/lib/agents/challenge.ts](../src/lib/agents/challenge.ts), [DisputeOS/src/lib/agents/resolution.ts](../src/lib/agents/resolution.ts), [DisputeOS/src/lib/interest.ts](../src/lib/interest.ts), [DisputeOS/src/lib/eval/scenarios.ts](../src/lib/eval/scenarios.ts).
5. **Code examples.** The mapping guide includes:
   - one reconstructed invoice and one email from a real pack, shown with the parser's `- item | qty N | £price` and `Label: value` conventions;
   - a draft `Scenario` / `ExpectedOutcome` object for one reference case, matching [DisputeOS/src/lib/eval/scenarios.ts](../src/lib/eval/scenarios.ts), with expected values taken from the court's decision.

   Figures must come from the judgment.
6. **Contracts (interfaces).**
   - **Commentary template.** Fixed headings, in order:
     - `# <case name> — <neutral citation>`
     - metadata bullets: Court / venue, Judge, Hearing / hand-down, Source, Tier
     - `## Inputs` → `### Parties`, `### Documents in evidence` (table: DisputeOS kind, Document, Date, Key content), `### Amounts`, `### Debtor's defences and complaints`
     - `## Outcome` → `### Decision on each defence` (Upheld / Rejected / Partly upheld), `### Money result`
     - `## Commentary`
   - **Document pack.**
     - Files are numbered in chronological order (`01-…`), `.txt` for documents and `.eml` for correspondence.
     - `manifest.json` has `name` (creditor first), `description` and `files`, in the same shape as [DisputeOS/public/samples](../public/samples).
     - Each file starts with an uppercase heading (no colon) or, for email, a `From:` line. Fields are `Label: value` lines with the labels the parser reads. Dates are ISO.
     - Non-GBP amounts carry a `Currency:` field.
   - **Reconstruction footer.** Every file ends with:
     ```
     --
     RECONSTRUCTED FROM THE PUBLISHED JUDGMENT. Not an original document.
     Source: <case> <neutral citation>, paras <n>.
     <what was not stated, approximated or simplified>
     ```
     The footer contains no document-kind keywords (invoice, delivery, remittance, agreement, contract, payment, dear, regards, thanks), so it does not affect classification.
   - **Mapping.** The mapping guide states the correspondence between court outcome and app output:
     - Upheld → `upheld`, Partly upheld → `partially_upheld`, Rejected → `rebutted`.
     - Money result → `defensiblePrincipalPence` and `totalRecoverablePence`.
     - Court outcome → expected `ProposalKind`.
     - Pack file kinds → `ExpectedOutcome.documentKinds`.
7. **Decision log.** Record in `Inputs/CONTRIBUTING.md`:
   - D1: London venue only (four non-London cases moved to `excluded-non-london/`, not deleted; they have no document pack).
   - D2: "Fully resolved" allows interest arithmetic, costs and the form of order to remain open.
   - D3: The borderline tier is kept rather than discarded, with the caveat on the Tier line.
   - D4: Commentaries and packs are AI-drafted from the full judgment text and must be human-checked before use as a benchmark.
   - D5: Appeals after the listed judgments were not checked.
   - D6: Packs are reconstructions, because trial bundles are not public. Facts the judgment does not state are marked `not stated`, collapsed to a lump-sum line, or left out. Nothing is invented.
   - D7: A pack is the creditor's file **before** judgment. Court findings (for example, altered or disputed documents) appear only in footers.
   - D8: Where the judgment describes no complaint letter, a **pleaded position letter** may set out the debtor's pleaded defences, with the footer saying no such letter exists (E-Nik, Addax).
   - D9: Large cases are cut down to the disputed invoices and key correspondence. A **statement of account** may replace invoices the judgment does not itemise.
   - D10: Correction log. The Bluewater commentary originally listed ASPO's invoices to Mercon as Mercon's invoices; corrected when the pack was built.
8. **Out-of-scope exclusions.** Stated in each doc's opening: not legal advice; reconstructions are not original documents; no guarantee of later appeal outcomes; foreign-currency figures are not converted.

## Implementation Decisions

- **Docs to build:** `Inputs/CONTRIBUTING.md` (template, reconstruction rules, decision log, review checklist) and `docs/reference-cases.md` (mapping guide and worked example).
- **Docs to modify:**
  - Root README: one link to the dataset index.
  - [DisputeOS/Inputs/README.md](README.md): link to the contributor guide and glossary; add a "Verified by / date" column once human review is done.
  - [DisputeOS/docs/glossary.md](../docs/glossary.md): already extended with document pack, reconstructed document, reconstruction footer, statement of account, pleaded position letter and intake classifier.
- **Seams (documentation coverage points).**
  1. *Document kind seam* (existing): the commentary's "Documents in evidence" table and each pack file ↔ `DocKind` in [DisputeOS/src/lib/types.ts](../src/lib/types.ts).
  2. *Intake seam* (existing, now exercised): pack files ↔ the intake classifier ([DisputeOS/src/lib/intake/classify.ts](../src/lib/intake/classify.ts)) and parser.
     - All 220 files were run through `classifyDocument` and `inferCase`.
     - All but two classify as the intended kind with confidence of at least 0.7. The two exceptions are statements of account (Ocean Healthcare, Gama), which classify as `other`.
  3. *Verdict seam* (existing): Outcome "Decision on each defence" ↔ `ChallengeVerdict` and `DisputeType`.
  4. *Money seam* (existing): Outcome "Money result" ↔ `ReconciliationOutput` / `ChallengeOutput` totals and [DisputeOS/src/lib/interest.ts](../src/lib/interest.ts) (statutory interest, fixed compensation).
  5. *Action seam* (existing): court outcome ↔ `ProposalKind`. For example:
     - creditor at fault → `issue_credit_note`;
     - partial defence → `offer_settlement`;
     - clean debt → `send_letter_before_action` + `prepare_court_claim`.
  6. *Eval seam* (proposed, highest level; replaces the earlier `case.json` proposal): each reference case becomes a `Scenario` with `source: "upload"` in [DisputeOS/src/lib/eval/scenarios.ts](../src/lib/eval/scenarios.ts).
     - It loads its pack through the same intake path as the existing upload scenario.
     - It has an `ExpectedOutcome` derived from the court's decision, so `npm run eval` measures agents against real outcomes.
     - Documented here as a proposal only; building it is out of scope.
- **Vocabulary terms** used verbatim from the glossary: case, creditor, debtor, document kind, document pack, reconstructed document, reconstruction footer, statement of account, pleaded position letter, intake classifier, supported principal, defensible principal, statutory interest, fixed compensation, set-off, counterclaim, verdict, proposal, approval gate, reference case, core, borderline, fully resolved, creditor at fault.
- **Style choices.**
  - Money in commentaries and packs is written as in the judgment (currency symbol or code, two decimals). The mapping guide converts to pence only inside code examples.
  - Case folders are named `<year>-<court-citation>-<short-parties>` in lowercase kebab case. Pack files are named `NN-<kind-ish-description>.txt|.eml`.

## Verification / Testing Decisions

- **Accuracy against source.** For every commentary and pack file, a reviewer checks each figure, date and verdict against the cited paragraph of `judgment.pdf`. Progress is tracked in the index. Done so far:
  - the Pharos commentary;
  - the Pharos purchase-order rates (£4,550 per day for personnel at para 72; £216,750 for 51 days of equipment at para 192; the £24,000 project-management lump sum);
  - the E-Nik solicitors' names.
  The remainder need review.
- **Classifier check.** Re-run the intake classifier over every pack after any edit; each file must classify as its intended kind with confidence ≥ 0.7, and `inferCase` must name the right creditor and debtor. Known, documented exceptions:
  - two statements of account classify as `other`;
  - the CEP debtor resolves to the parent company;
  - the mixed GBP/EUR International Media Advertising total is wrong because the app reads all amounts as pounds.
  The check uses only exported app functions and can become a Vitest test.
- **Footer check.** Every file in every `documents/` folder contains the reconstruction footer (a grep check; currently 220 of 220).
- **Accuracy against code.** Every DisputeOS kind, verdict and proposal kind named in a commentary, pack description or the mapping guide must exist in [DisputeOS/src/lib/types.ts](../src/lib/types.ts).
- **Completeness.** Every London case folder has `judgment.pdf`, `commentary.md` and `documents/manifest.json`, the manifest lists every file in the folder, and every commentary heading from Requirement 6 is present. Every case in the index links to an existing folder and vice versa.
- **Glossary consistency.** Terms in bold in any dataset doc appear in [DisputeOS/docs/glossary.md](../docs/glossary.md). No doc redefines a glossary term.
- **Readability.** A developer unfamiliar with English law can read one commentary and the mapping guide, upload the pack, and correctly state the expected verdicts and proposal kinds for that case (a reviewer tests this on two cases).
- **Licence.** The index states the Open Justice Licence attribution for the judgment PDFs.

## Out of Scope

- Changing agent logic, prompts, the intake classifier or fixtures to match the reference cases. This includes adding a statement-of-account document kind and multi-currency support, which are noted as app limitations only.
- Building the eval scenarios for reference cases (proposed seam only).
- Adding reference packs to `public/samples/` or the demo's upload menu.
- Obtaining original trial documents.
- Checking appeals or later history of any case.
- Cases outside London, outside England and Wales, or not fully resolved, including the 56 reviewed and rejected judgments, and packs for the four excluded non-London cases.
- Legal advice, and any claim that DisputeOS output would match a court.
- Publishing the dataset outside the repository.

## Further Notes

- **Dataset size:** 22 cases (15 core, 7 borderline), from 244 search hits and 81 reviewed judgments. 4 non-London cases are kept in `excluded-non-london/`. The 22 document packs contain 220 files plus manifests.
- **Closest analogues to the demo:**
  - International Media Advertising v Turkey: the creditor is at fault, like the Ashford sample pack.
  - Pharos Offshore v Keynvor Morlift: a partly upheld defect complaint is set off against unpaid invoices, like the Kestrel sample pack.
- **Gold labels differ from the existing eval.** The existing scenarios' expected values are derived by hand from contract terms and statute as at `EVAL_AS_OF`. Reference cases would use the court's findings. Before using court outcomes as gold labels, the mapping guide must say which fields are comparable (defence verdicts, direction of the result, proposal kinds) and which are not (for example interest, which courts often left to be agreed, and costs).
- **Known data caveats:** several judgments state two different figures for the same sum or leave the net figure unstated. Commentaries and footers record both and label any arithmetic of their own.
- **Interest rate:** the code default `BOE_BASE_RATE=4.0` must be checked against the current Bank of England rate before reference-case interest comparisons are made.
- **Revision 2 changes:**
  - adds the document-pack layer, reconstruction rules, the intake seam and the classifier and footer checks;
  - points the evaluation seam at the eval harness that now exists;
  - updates code references after fixtures moved to `src/lib/fixtures/cases.ts` and the demo became upload-first.
- This spec was synthesised from the code, the dataset and the session's research, without an interview.
