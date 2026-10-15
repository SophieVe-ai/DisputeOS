# DisputeOS

**Autonomous multi-agent dispute resolution for UK SMEs, with a tamper-evident on-chain audit trail and a human approval gate.**

UK research estimates small businesses were owed roughly **£26.5 billion** in late payments in the 2025 fiscal year. Chasing a disputed invoice means digging out the contract, invoices, delivery notes and emails, re-checking every quantity and price, working out who is actually right, and then drafting a letter that stands up. DisputeOS does that work with four AI agents, then a fifth, long-running Negotiation agent that wakes whenever the debtor replies. A named human approves every outbound action, and every agent action is written to an append-only log anchored on a blockchain, so the agents cannot rewrite their own history.

```
 Case file ─▶ 🔎 Evidence ─▶ 🧮 Reconciliation ─▶ ⚔️ Challenge ─▶ ✍️ Resolution ─▶ 🛡️ Human approval ─▶ Execute
                  │                │                    │                 │                   │
                  └────────────────┴──── append-only, hash-chained ledger ─┴───────────────────┘
                                                   │
                                     AuditLog.sol (EVM) — no edit / delete functions
```

| Agent | Job | Engine |
| --- | --- | --- |
| **Evidence** | Finds the contract, invoices, delivery records, payments and relevant correspondence. Extracts structured facts, detects disputes the debtor raised, and flags evidential gaps. Each document's SHA-256 is logged. | Rules parser, plus Claude for real-world documents (table invoices, prose contracts) and free-text correspondence |
| **Reconciliation** | Checks quantities, contract prices, invoiced prices, deliveries and payments. Computes the supported principal plus statutory interest and fixed compensation under the *Late Payment of Commercial Debts (Interest) Act 1998*. | **Deterministic by design**: no LLM touches the money |
| **Challenge** | An internal devil's advocate. It argues the debtor's case (inspection windows, short delivery, our own overcharges, missing proof of delivery, the Limitation Act 1980) and decides what is defensible. | Rules, plus Claude adversarial review |
| **Resolution** | Chooses a strategy and drafts the documents: letter before action, settlement offer, credit note, Money Claim Online particulars, or a write-off memo. | Templates, plus Claude drafting with a guard rail that rejects any draft that changes the figures |

After the agents finish, **nothing happens until a person approves**. Each approval or rejection is recorded on the ledger under the approver's name, and only approved actions execute.

## Why the ledger can't be rewritten by an agent

1. **Agents only get an `append` closure.** `AgentContext` (`src/lib/agents/context.ts`) is frozen and exposes no database handle, ledger reader or signing key. The actor name is fixed by the orchestrator.
2. **The database is append-only.** SQLite triggers abort any `UPDATE` or `DELETE` on `ledger_entries`.
3. **The log is hash-chained.** Each entry commits to its payload hash and to the previous entry's hash.
4. **It is anchored on-chain.** Each entry hash is written, in order, to `contracts/AuditLog.sol`. The contract enforces the chain link (`BrokenChain`), rejects duplicates, accepts only authorised writers, and has **no edit or delete function** (a test asserts this).
5. **Verification is independent.** *Verify against chain* recomputes every hash from the stored data and compares it with the immutable on-chain anchors.

The demo includes **☠ Simulate tampering**: an insider with raw database access drops the trigger, rewrites the Challenge agent's conclusion and even recomputes that row's hash. Verification still catches it, because the recomputed hash no longer matches the on-chain anchor and the next entry's link breaks.

## Quick start (one command)

Requires Node.js 22+.

```bash
npm install
npm run demo          # resets the DB (empty), starts a local EVM chain, deploys AuditLog, starts the app
open http://localhost:3000
```

Optional: `cp .env.example .env.local` and set `ANTHROPIC_API_KEY` to run the agents on **Claude (`claude-opus-5-5`)**. Without a key, the same pipeline runs on the deterministic engine, so the demo never depends on network access. If a Claude call fails or is refused, that step falls back to the deterministic result and the fallback is logged to the ledger.

See **[DEMO.md](DEMO.md)** for the 3-minute judge walkthrough.

## Upload a case file

`/cases/new` takes raw documents (`.txt`, `.md`, `.eml`, `.csv`, `.pdf`; up to 15 files, 2 MB each). The server extracts the text (PDFs via `unpdf`), classifies each document (contract, invoice, delivery note, payment, correspondence) with a confidence score, and infers the creditor, debtor, debtor email and outstanding balance. You review and correct anything, then **Create case & run agents** opens the case, starts the pipeline and takes you to the live view. Nothing is written until you confirm. There is no pre-loaded data: four sample case files live in `public/samples/` (regenerate with `npx tsx scripts/build-sample-packs.ts`).

Every ledger entry carries a one-line plain-English description (`src/lib/ledger/describe.ts`), shown in the on-chain write log and the audit ledger.

## Real-world documents

The rules parser reads documents in DisputeOS's simple `Key: value` / `- Item | qty N | £price` format. With `ANTHROPIC_API_KEY` set, anything it can't read (a table-layout PDF invoice, a contract written in prose, a free-text delivery confirmation or bank transfer) is read by Claude instead (`src/lib/agents/extraction.ts`):

- **Claude reads, never calculates.** It returns the figures exactly as printed. Every amount and quantity must literally appear in the source document ("grounding"); anything that doesn't is discarded and listed as an evidential gap. An invoice whose lines don't add up to its stated total is flagged.
- **Rules first.** Documents the parser already reads never go to Claude, so known formats stay fully deterministic.
- **Audited.** Each Claude-read document gets its own ledger entry ("Read “Invoice ACE-7781” with Claude: 2 lines, £3,860.00. Every figure checked against the document…").
- **Arithmetic stays deterministic.** Reconciliation still computes everything from the grounded facts.
- **Upload preview too.** When the rules can't classify a file or work out the parties and balance, Claude fills those in (marked **AI** on the review screen). The balance is built only from grounded figures.

Without a key, or if a Claude call fails, the pipeline falls back to the rules engine and logs the fallback.

## Long-running negotiation (the fifth agent)

The case doesn't end when a letter goes out. Once a human approves a letter that expects a reply (letter before action, settlement offer, or any follow-up), the run goes to sleep in `awaiting_response`, and the **Negotiation agent** (`src/lib/negotiation/`) takes over:

```
 approve letter ─▶ 💤 awaiting_response ──(debtor replies)──────▶ 🤝 Negotiation turn ─▶ 🛡️ approval ─▶ send ─▶ 💤 …
                         └──(follow-up deadline passes)──────▶ 🤝 Negotiation turn ─┘
```

- **Woken by the other side.** A reply is posted to `POST /api/cases/:id/replies`, either by your inbound-email integration or pasted on the case page. It is stored, its SHA-256 is ledgered under the debtor's name (`counterparty:…`), and the agent wakes on the next worker tick.
- **Woken by silence.** Every sent letter arms a durable follow-up timer (14 days for a letter before action, 7 for a reminder, the promised date plus 2 days for a payment promise). If nobody replies, the timer wakes the agent.
- **Reads the reply.** It classifies it as paid, counter-offer, promise to pay, dispute, refusal, request for information, or acknowledgement. The rules engine does this offline; Claude does it when configured, but any figure or date Claude returns must appear verbatim in the reply or it is discarded.
- **Deterministic money policy** (`policy.ts`). It accepts an offer at or above the Challenge agent's defensible principal and counters below it. It escalates after two rejected counters, chases the balance after a part payment, and closes the case once payment covers what's on the table (the approver is told to check the bank first). It answers disputes the Challenge agent already assessed and sends a holding reply for new points. Silence gets one final reminder, then escalation to a court claim. **It never proposes settling below the defensible principal.**
- **Back through the gate.** Every move is a drafted letter the human approves or rejects. Approving it sends the letter and re-arms the timer. A closure or escalation ends the engagement. If every draft is rejected, the agent keeps waiting with a routine follow-up, so a case can never stall silently.
- **Durable and leased.** Wake-ups live in SQLite (`run_wakeups`) and are leased like runs. Only one turn per case runs at a time, a reply that arrives while a decision is pending waits for the gate, and a turn that crashes is retried (3 attempts with backoff).

For demos, `FOLLOW_UP_DAY_MS=5000` turns a "day" into 5 seconds, and in `DEMO_MODE` the case page offers **Fast-forward to deadline** (logged on the ledger as `system:demo-clock`) and sample debtor replies.

## Agent eval

`npm run eval` (or the **Evals** page) runs five gold-labelled disputes end-to-end, one of them built from the raw sample upload, each in its own in-memory database and chain. The expected answers are derived by hand from the contracts, delivery records and statute (Limitation Act 1980, Late Payment Act 1998), not from the agents' output.

| Axis | Weight | What is scored |
| --- | --- | --- |
| **Optimisation** | 70% | Supported principal, days overdue, defensible principal (continuous accuracy), recommendation, the verdict on each debtor argument, the proposed actions and their order, and on-chain verification of the audit trail |
| **Efficiency** | 30% | Pipeline latency against a per-engine budget, first-attempt success (no retries), model fallbacks, ledger writes against a proportionate budget |

The result is a single percentage. The web UI runs the eval in a child process, so it never touches live cases, and anchors every result on-chain as an `eval.completed` ledger entry. CI fails if the score drops below 90% (`npm run eval -- --min 90`).

## Long-running agents platform

- **Durable runs.** Each run is a state machine in SQLite (`runs`, `run_steps`), and each agent step's output is persisted.
- **Leased worker.** A background worker (`src/lib/orchestrator/worker.ts`, started from `instrumentation.ts`) atomically leases runs. If the server crashes mid-run, the lease expires and the run resumes from the last completed step.
- **Retries with backoff.** A failing step retries up to 3 times with exponential backoff, then the run is marked failed. Every attempt is logged.
- **Ordered anchoring.** A serialised queue anchors ledger entries to the chain in order. It recovers after chain restarts and keeps working offline: entries stay *pending* until the chain is reachable.

## Tech

Next.js 16 (App Router) · TypeScript · Tailwind v4 · SQLite (better-sqlite3) · Anthropic SDK (structured outputs + Zod) · Solidity 0.8.24 · Hardhat · ethers v6 · Vitest · GitHub Actions.

```
src/lib/agents/        Evidence, Reconciliation, Challenge, Resolution + templates + Claude client
src/lib/negotiation/   Negotiation agent: reply classifier, deterministic policy, follow-up letters
src/lib/orchestrator/  runner (state machine), worker (leases), approvals (human gate), engagement (replies, timers)
src/lib/ledger/        hash chain, anchoring, verification, tamper simulation
src/lib/repo/          SQLite repositories
src/app/api/           REST API (envelope: { success, data, error })
contracts/             AuditLog.sol
contract-tests/        Hardhat tests
scripts/               deploy, DB reset, E2E smoke test
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run demo` | Full local stack: reset DB, start chain, deploy contract, start dev server |
| `npm run eval` | Agent eval: optimisation + efficiency score across gold scenarios (`-- --json`, `-- --min 90`) |
| `npm run verify` | Lint, typecheck, unit tests with coverage, contract tests, production build |
| `npm test` / `npm run test:coverage` | Vitest unit and integration tests (gate: ≥80% lines) |
| `npm run test:contracts` | Hardhat tests for `AuditLog.sol` |
| `node scripts/smoke-e2e.mjs` | E2E: run agents → approve → verify on-chain → detect tampering (needs a running stack) |
| `npm run chain:deploy:testnet` | Deploy to a public testnet (`TESTNET_RPC_URL`, `LEDGER_PRIVATE_KEY`) |

### Using a public testnet

```bash
TESTNET_RPC_URL=https://sepolia.base.org LEDGER_PRIVATE_KEY=0x... npm run chain:deploy:testnet
CHAIN_RPC_URL=https://sepolia.base.org LEDGER_PRIVATE_KEY=0x... npm run dev
```

The public Hardhat development key is refused on any chain other than the local one (chain ID 31337).

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/cases` | Case list with latest run summary |
| `POST` | `/api/cases` | Open a case with documents (Zod-validated) |
| `GET` | `/api/cases/:id` | Case, documents, run, step outputs, proposals |
| `POST` | `/api/cases/:id/runs` | Start the agent pipeline (409 if one is active) |
| `POST` | `/api/proposals/:id/decision` | Approve or reject a drafted action (`APPROVAL_PIN` optional) |
| `POST` | `/api/cases/:id/replies` | Record a debtor reply (`{ from, subject?, body }`) and wake the Negotiation agent (409 if nothing has been sent) |
| `POST` | `/api/cases/:id/close` | A named human stops the follow-up and closes the case |
| `GET` | `/api/ledger?caseId=` | Ledger entries with anchor status |
| `POST` | `/api/ledger/verify` | Verify hash chain and on-chain anchors |
| `GET` | `/api/system` | Engine, chain, worker and ledger status |
| `POST` | `/api/demo/tamper` | Demo only. Enabled solely when `DEMO_MODE=1` (set by `npm run demo`) |
| `POST` | `/api/demo/fast-forward` | Demo only. Fires the case's next follow-up deadline now (ledgered) |

## MVP limitations and roadmap

- **Local-only, single-tenant, no login.** The API is unauthenticated, with no rate limiting or CSRF checks. `npm run demo` binds to `127.0.0.1` only. The approver is identified by name, with an optional PIN (`APPROVAL_PIN`). Production needs SSO, role-based approval limits, rate limiting and origin checks.
- **No real outbound sending or inbound mailbox.** Approved actions are *executed* by recording a queued dispatch, and replies arrive through `POST /api/cases/:id/replies`. Next steps: email/post integration, an inbound-email webhook with a signing secret, and HMCTS Money Claim Online submission.
- **Structured document intake.** The offline parser expects simple `key: value` and `- item | qty N | £price` lines. With Claude enabled, free-text correspondence is read too. PDF and OCR intake are on the roadmap.
- **Documents are untrusted input to the LLM.** Claude never sets money figures: reconciliation is deterministic, Claude challenge items with a non-zero impact are capped, and drafted letters must contain the exact computed total or they are rejected.
- **Bank of England base rate is configurable** (`BOE_BASE_RATE`, default 4.0). Verify the current rate before relying on interest figures.
- **Proposals are independent.** A reviewer could approve both a letter before action and a settlement offer. Sequencing and mutual-exclusion rules are on the roadmap.
- **Not legal advice.** Drafts are for review by the business and its advisers.

## Licence

MIT
