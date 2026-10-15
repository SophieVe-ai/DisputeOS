# DisputeOS glossary

The vocabulary used across the code, the docs and the `Inputs/` case dataset. Where a term maps to code, the identifier is given in `code` style.

## Cases and documents

| Term | Meaning |
|---|---|
| **Case** (`DisputeCase`) | One debt being recovered from one debtor: reference, title, creditor, debtor, claimed amount, summary and status. |
| **Case reference** | Human-readable ID, e.g. `DOS-2026-0141`. |
| **Creditor** | The business owed money; DisputeOS acts for it. In court cases, usually the claimant (or the counterclaiming supplier). |
| **Debtor** | The business that has not paid. |
| **Claimed amount** (`claimedAmountPence`) | What the creditor says is outstanding when the case is opened, before any checks. |
| **Case status** (`CaseStatus`) | `open`, `in_review`, `awaiting_approval`, `resolved`, `closed`. |
| **Document** (`CaseDocument`) | One piece of evidence attached to a case. |
| **Document kind** (`DocKind`) | `contract`, `invoice`, `delivery_note`, `payment`, `correspondence`, `other`. |
| **Contract** | Terms agreed between the parties: prices, payment terms, inspection period. |
| **Delivery note** | Proof that goods or services were supplied; ideally signed. Covers PODs, site sign-offs, timesheets and progress reports. |
| **Payment** | A remittance or other record of money received. |
| **Correspondence** | Emails and letters, including the debtor's complaints. |
| **Extracted facts** (`ExtractedFacts`) | Structured data the Evidence agent pulls from documents: contract, invoices, deliveries, payments, disputes. |

## Money

| Term | Meaning |
|---|---|
| **Pence** | All money is stored as integer pence. Never floats. |
| **Invoiced total** | Sum of all invoices on the case. |
| **Outstanding** | Invoiced total less payments received. |
| **Supported principal** | The part of the outstanding sum backed by contract prices and delivered quantities. |
| **Overcharge** | Amount invoiced above the contract price. The creditor's own error. |
| **Short delivery** | Amount invoiced for goods or services not delivered. |
| **Defensible principal** | Supported principal less the deductions from upheld challenges. What the creditor can credibly demand. |
| **Statutory interest** | Interest under the Late Payment of Commercial Debts (Interest) Act 1998: Bank of England base rate (`BOE_BASE_RATE`) plus 8% (`STATUTORY_UPLIFT_PERCENT`), simple. |
| **Fixed compensation** | Per-invoice sum under the 1998 Act: £40 below £1,000, £70 from £1,000 to £9,999.99, £100 from £10,000. |
| **Contractual interest** | Interest at a rate set by the contract. Where it is a substantial remedy, it displaces statutory interest. |
| **s.35A interest** | Discretionary interest the court may award under the Senior Courts Act 1981 when neither statutory nor contractual interest applies. |
| **Total recoverable** | Defensible principal plus interest plus compensation. |
| **Set-off** | Deducting a sum the creditor owes the debtor (for example damages for defects) from the debt. |
| **Counterclaim** | A claim the debtor brings back against the creditor in the same proceedings. |
| **Net position** | The result after set-off: who owes whom, and how much. |

## Agents and runs

| Term | Meaning |
|---|---|
| **Agent** (`AgentName`) | One of four pipeline stages: `evidence`, `reconciliation`, `challenge`, `resolution`. |
| **Evidence agent** | Reads documents, extracts facts, detects debtor disputes, flags evidential gaps, logs document hashes. |
| **Reconciliation agent** | Deterministic. Matches contract, invoices, deliveries and payments line by line; computes principal, interest and compensation. No LLM touches the money. |
| **Challenge agent** | Internal devil's advocate. Argues the debtor's side and gives each point a verdict. |
| **Resolution agent** | Chooses a strategy and drafts proposals. |
| **Engine** (`Engine`) | `claude` (LLM-assisted) or `deterministic` (rules only). Claude failures fall back to deterministic, and the fallback is logged. |
| **Run** (`Run`) | One execution of the four agents on a case. Status: `queued`, `running`, `awaiting_approval`, `completed`, `failed`. |
| **Run step** (`RunStep`) | One agent's execution within a run, with persisted output. |
| **Lease** | A time-limited lock a worker takes on a run, so a crashed run resumes from its last completed step. |

## Challenge vocabulary

| Term | Meaning |
|---|---|
| **Challenge** (`Challenge`) | One debtor-side argument (raised by the debtor or found by the agent). |
| **Dispute type** (`DisputeType`) | Category of debtor complaint: `damage`, `shortfall`, `quality`, `pricing`, `non_receipt`, `other`. |
| **Verdict** (`ChallengeVerdict`) | `upheld` (the debtor is right), `partially_upheld` (some merit, or needs more evidence), `rebutted` (the debtor is wrong). |
| **Impact** (`impactPence`) | Extra deduction from principal if the challenge stands. |
| **Severity** | `low`, `medium`, `high`. Drives the confidence score. |
| **Inspection period** | Contract window for notifying defects. Complaints after it are treated as deemed acceptance. |
| **Confidence** | 0 to 1 score of how defensible the claim is after challenges. |
| **Recommendation** (`Recommendation`) | `pursue_full`, `pursue_reduced`, `negotiate`, `write_off`. |
| **Limitation** | Six-year time bar on contract debts under the Limitation Act 1980. |

## Proposals and approval

| Term | Meaning |
|---|---|
| **Proposal** (`Proposal`) | A drafted action awaiting a human decision. |
| **Proposal kind** (`ProposalKind`) | `send_letter_before_action`, `offer_settlement`, `issue_credit_note`, `prepare_court_claim`, `write_off`. |
| **Letter before action (LBA)** | Formal demand giving 14 days to pay, per the Practice Direction on Pre-Action Conduct. |
| **Settlement offer** | Offer to accept the defensible principal, usually waiving interest, for prompt payment. |
| **Credit note** | Correction issued by the creditor where its own invoice overstated what is owed. |
| **Court claim pack** | Draft Money Claim Online particulars of claim. |
| **Write-off memo** | Record that the debt is not worth pursuing. |
| **Approval gate** | The rule that nothing executes until a named person approves it. |
| **Guard rail** | Check that rejects any LLM-drafted document whose figures differ from the computed total. |

## Ledger

| Term | Meaning |
|---|---|
| **Ledger entry** (`LedgerEntry`) | An append-only record of an agent action or human decision. |
| **Hash chain** | Each entry commits to its payload hash and the previous entry's hash, starting from the genesis hash. |
| **Anchor** | The entry hash written to the `AuditLog` smart contract. Status: `pending`, `anchored`, `error`. |
| **Verify against chain** | Recomputes every hash and compares it with the on-chain anchors (`match`, `mismatch`, `missing`, `unavailable`). |
| **Tamper simulation** | Demo-only endpoint that rewrites a ledger row to show verification catching it. |

## Reference case dataset (`Inputs/`)

| Term | Meaning |
|---|---|
| **Reference case** | A real, published English judgment used as a benchmark for agent behaviour. |
| **Invoice dispute** | A case where a claim to be paid on invoices (or the invoiced price) is a central issue. |
| **Fully resolved** | After trial or final appeal, the court decided liability and what is owed; only interest arithmetic, costs or the form of order were left. |
| **Core** | Reference case where unpaid invoices were the main dispute and the money result was fully decided. |
| **Borderline** | Fully resolved reference case with a stated caveat (side claim, final account, summary judgment, or further claims pending). |
| **Excluded (non-London)** | Fully resolved, but heard outside London; kept for reference only. |
| **Commentary** | The `commentary.md` for a reference case: Inputs, Outcome, Commentary sections. |
| **Neutral citation** | The court's official case reference, e.g. `[2025] EWHC 1764 (TCC)`. |
| **Creditor at fault** | Outcome where the court found the invoicing party overcharged or misrepresented; the reference equivalent of a credit-note case. |
| **Document pack** | A folder of case documents plus a `manifest.json` (`name`, `description`, `files`) in the upload format used by `public/samples/`. |
| **Reconstructed document** | A document in a reference case's `documents/` pack, rebuilt from facts stated in the judgment. Not an original; marked by a reconstruction footer. |
| **Reconstruction footer** | The closing block of every reconstructed document: a statement that it is not an original, the judgment citation and paragraphs, and anything not stated, approximated or simplified. |
| **Statement of account** | A single document listing several invoices and payments with a running balance. Used in packs where the judgment does not describe individual invoices. The app has no matching document kind. |
| **Pleaded position letter** | A reconstructed letter that sets out a party's defences from its pleaded case, used where the judgment describes no complaint letter. Its footer says no such letter exists. |
| **Intake classifier** | `classifyDocument` / `inferCase` in `src/lib/intake/classify.ts`: decides each uploaded file's document kind and infers creditor, debtor and claimed balance. |
