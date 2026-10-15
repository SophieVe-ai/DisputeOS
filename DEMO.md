# DisputeOS — 3-minute demo script for judges

**Setup (before you present):** `npm install && npm run demo`, then open <http://localhost:3000>.
Check the header shows **hardhat-local · 0x5FbD…** in green. To show Claude live, set `ANTHROPIC_API_KEY` in `.env.local` first. Otherwise the header shows *Deterministic engine*, and the flow is identical.

---

The app starts **empty**: there are no pre-loaded cases. Everything on screen is created live during the demo, from documents you upload. Four sample case files ship in `public/samples/` so you don't need your own.

### 1. The problem (20s): home
> "UK SMEs were owed about £26.5bn in late payments last year. Recovering it is slow, manual and adversarial. DisputeOS is an AI-native collections and disputes team."

Point at the hero: the crosshair reads the live block number from the chain. The on-chain write log next to the (empty) disputes table is waiting for its first write.

### 2. Upload a case file (40s): *Upload*
Click **Upload a case file** and pick the sample **Harbour Joinery v Kestrel Developments**. Seven raw files (contract, delivery note, invoice, remittance, three emails) are read and classified, each with a confidence score, and the parties and the £12,920 balance are filled in. Correct anything you like, then click **Create case & run agents**.

### 3. Watch the agents, and the chain (60s)
You land on the case. The banner at the top says what's happening; the pipeline lights up step by step, and every action appears in the **On-chain write log** in plain English ("Reviewed “Invoice HJ-1042” (invoice) and recorded its fingerprint") with a ✓ and its block number once mined. Flip **Technical** to show the hashes, transaction, gas and the decoded `EntryAnchored` event read back from the contract.
- **Evidence** reviews 7 documents and finds two debtor complaints.
- **Reconciliation** checks every line: £12,920 owed after the £5,000 part payment. "No LLM touches the money."
- **Challenge** argues the debtor's side. It **upholds** the 3 damaged units (reported inside the 5-day inspection window, −£1,155) and **rebuts** the "poor quality" complaint (78 days late). Defensible: **£11,765** at 85% confidence.
- **Resolution** drafts a letter before action, a settlement offer and a court-claim pack.

### 4. Human in control (30s)
The banner now says the drafted actions need your decision. Enter your name in the **Approval gate**, open the letter and **Approve & execute**. Reject the court pack: "not yet." Both decisions appear in the chain log under your name.
> "Agents never act on their own. Every decision is signed by a named person and recorded on-chain."

### 5. Honesty as a feature (20s)
Upload the **Peak Catering v Ashford Hotel Group** sample. The Challenge agent finds **we** overcharged (£4.20 vs £3.95 contract price) and short-delivered 4 cases. The first proposed action is a **£614 credit note**, before demanding the rest.
> "It tells you when *you're* wrong, before the court does."

### 6. Tamper-proof agent logs (40s): back to Kestrel
Scroll to the **Audit ledger**. Every entry has a one-line description of what happened. Click **Verify against chain**: green. Click **Simulate tampering** (an insider rewrites the Challenge agent's conclusion in the database and recomputes its hash), then **Verify against chain** again: **red**. The chain log marks the entry **✕ altered**.
> "An agent, or anyone else, can't quietly change what it decided."

### 7. Measured, not asserted (20s): *Evals*
Click **Run the eval**. Five gold-labelled disputes, one built from raw uploaded files, run in an isolated sandbox. The gauge shows the overall score (70% optimisation, 30% efficiency); each scenario lists expected vs actual, and the result is itself anchored on-chain.

### Close (10s)
> "Evidence, reconciliation, challenge, resolution, then human approval, with a cryptographic audit trail. DisputeOS: get paid, provably fairly."

---

**Backup if anything misbehaves:** the app works with the chain offline (entries show *writing* and anchor once the chain is back), and with no Claude key (deterministic engine). `node scripts/smoke-e2e.mjs` runs the whole flow headless. To reset between run-throughs, press Ctrl+C and run `npm run demo` again.
