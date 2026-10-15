# DisputeOS — 3-minute demo script for judges

**Setup (before you present):** `npm install && npm run demo`, then open <http://localhost:3000>.
Check the header shows **hardhat-local · 0x5FbD…** in green. To show Claude live, set `ANTHROPIC_API_KEY` in `.env.local` first. Otherwise the header shows *Deterministic engine*, and the flow is identical.

To reset between run-throughs, press Ctrl+C and run `npm run demo` again.

---

### 1. The problem (20s), dashboard
> "UK SMEs were owed about £26.5bn in late payments last year. Recovering it is slow, manual and adversarial. DisputeOS is an AI-native collections and disputes team."

Point at the animated system topology (each agent writes into `AuditLog.sol`, which mines blocks), the three seeded cases, and the **On-chain write log** already showing the intake entries mined.

### 2. Run the agents (60s): *Kitchen units — Kestrel Developments*
Open the case and click **Run agents**. While the pipeline lights up, keep an eye on the **On-chain write log** on the right: every agent action appears as it's written (`sha256`, then `eth_sendTransaction … awaiting block`), then flips to **mined** with its real tx hash, block number, gas used and the decoded `EntryAnchored` event read back from the contract. New blocks slide into the block strip.
- **Evidence** reviews 7 documents (each document's hash goes on the ledger) and finds two debtor complaints.
- **Reconciliation** checks every line against the contract and delivery note: £12,920 is owed after the £5,000 part payment. "No LLM touches the money."
- **Challenge** argues the debtor's side. It **upholds** the 3 damaged units (reported 3 days after delivery, inside the 5-day inspection window, so –£1,155) and **rebuts** the "poor quality" complaint (78 days late, deemed accepted). Defensible: **£11,765** at 85% confidence.
- **Resolution** drafts a letter before action (with statutory interest), a settlement offer and a court-claim pack.

### 3. Human in control (30s)
In the **Approval gate**, enter your name, open the letter (a real, compliant letter before action) and click **Approve & execute**. Reject the court pack: "not yet."
> "Agents never act on their own. Every decision is signed by a named person and recorded on-chain."

### 4. Honesty as a feature (20s): *Catering consumables — Ashford Hotel Group*
Run it. The Challenge agent finds **we** overcharged (£4.20 vs £3.95 contract price) and short-delivered 4 cases. The first proposed action is a **£614 credit note**, before demanding the rest.
> "It tells you when *you're* wrong, before the court does."

### 5. Tamper-proof agent logs (40s): back to Kestrel
Scroll to **Tamper-evident audit ledger** and click **Verify against chain**: green, every entry matches its on-chain anchor.
Click **Simulate tampering**: an insider rewrites the Challenge agent's conclusion straight in the database and even recomputes the hash.
Click **Verify against chain** again: **red**. The rewritten entry no longer matches its immutable anchor, and the next entry's chain link is broken. The on-chain write log shows the same thing live: that entry now reads **✕ MISMATCH ledger 0x… ≠ chain 0x…**.
> "An agent, or anyone else, can't quietly change what it decided."

### Close (10s)
> "Evidence, reconciliation, challenge, resolution, then human approval, with a cryptographic audit trail. DisputeOS: get paid, provably fairly."

---

**Backup if anything misbehaves:** the app works with the chain offline (entries show *pending* and anchor once the chain is back), and with no Claude key (deterministic engine). `node scripts/smoke-e2e.mjs` runs the whole flow headless.
