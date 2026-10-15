// End-to-end smoke test against a running stack (chain + deployed contract + Next server).
// Exercises the critical flow: upload documents → run agents → human approval →
// debtor replies wake the Negotiation agent → settlement → on-chain verification → tamper detection. The app starts empty, so the case comes
// from the Ashford sample pack through the real intake API.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PACK_DIR = path.join(process.cwd(), "public", "samples", "ashford");
// Against a deployment without a chain set SMOKE_CHAIN=0; SMOKE_TAMPER=0 skips the tamper step
// (it permanently marks the ledger as tampered, which you don't want on a shared deployment).
const CHAIN = process.env.SMOKE_CHAIN !== "0";
const TAMPER = process.env.SMOKE_TAMPER !== "0";
// Claude mode makes several model calls per run; raise with SMOKE_TIMEOUT_MS if needed.
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 90_000);

/** An error that should stop waiting immediately instead of being retried until the timeout. */
class Fatal extends Error {}

async function call(path, init) {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: isForm ? undefined : { "content-type": "application/json" } });
  const body = await res.json();
  if (!body.success) throw new Error(`${path} → ${res.status}: ${body.error}`);
  return body.data;
}

function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
  console.log(`  ✓ ${message}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const v = await fn().catch((err) => {
      if (err instanceof Fatal) throw err;
      return null;
    });
    if (v) return v;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  console.log(`DisputeOS E2E smoke test → ${BASE}`);
  if (CHAIN) {
    await waitFor(async () => (await call("/api/system")).chain.connected, "chain connection");
    assert(true, "app is up and connected to the AuditLog contract");
  } else {
    await call("/api/system");
    assert(true, "app is up (chain checks skipped)");
  }

  const { files } = JSON.parse(fs.readFileSync(path.join(PACK_DIR, "manifest.json"), "utf8"));
  const form = new FormData();
  for (const f of files) form.append("files", new Blob([fs.readFileSync(path.join(PACK_DIR, f))], { type: "text/plain" }), f);
  const preview = await call("/api/intake/preview", { method: "POST", body: form });
  assert(preview.documents.length === files.length && preview.inferred.claimedAmountPence === 954_000, `uploaded ${files.length} documents; inferred a £9,540 balance`);

  const created = await call("/api/cases", {
    method: "POST",
    body: JSON.stringify({
      ...preview.inferred,
      documents: preview.documents.map(({ kind, title, content, docDate }) => ({ kind, title, content, docDate })),
    }),
  });
  const CASE_ID = created.id;
  await call(`/api/cases/${CASE_ID}/runs`, { method: "POST", body: JSON.stringify({ requestedBy: "CI Bot" }) });
  const detail = await waitFor(async () => {
    const d = await call(`/api/cases/${CASE_ID}`);
    if (d.run?.status === "failed") throw new Fatal(`run failed: ${d.run.error}`);
    return d.run?.status === "awaiting_approval" ? d : null;
  }, "agents to finish");
  assert(detail.steps.every((s) => s.status === "done"), "all four agents completed");
  assert(detail.proposals[0].kind === "issue_credit_note" && detail.proposals[0].amountPence === 61_400, "challenge caught our own £614 overcharge/short delivery");

  const approved = await call(`/api/proposals/${detail.proposals[0].id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", approver: "CI Bot" }),
  });
  assert(approved.status === "executed", "approved action executed");

  // ---- Long-running negotiation: send the letter, then let debtor replies drive the agent ----
  const decide = (id, decision) => call(`/api/proposals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision, approver: "CI Bot" }) });
  for (const p of detail.proposals.slice(1)) await decide(p.id, p.kind === "send_letter_before_action" ? "approve" : "reject");
  let state = await call(`/api/cases/${CASE_ID}`);
  assert(state.run.status === "awaiting_response" && state.nextWakeup?.kind === "deadline", "letter sent; agent asleep with a follow-up timer");
  const floor = state.negotiation.floorPence;

  const nextMove = async (body, label) => {
    await call(`/api/cases/${CASE_ID}/replies`, { method: "POST", body: JSON.stringify({ from: "Ashford Hotel Group", body }) });
    return waitFor(async () => {
      const d = await call(`/api/cases/${CASE_ID}`);
      if (d.turns.some((t) => t.status === "failed")) throw new Fatal(`negotiation turn failed: ${d.turns.find((t) => t.status === "failed").error}`);
      return d.run.status === "awaiting_approval" ? d.proposals.find((p) => p.status === "pending") : null;
    }, label);
  };
  const counter = await nextMove("We are prepared to pay £2,000.00 in full and final settlement.", "agent to answer the low offer");
  assert(counter.kind === "offer_settlement" && counter.amountPence === floor, `low offer woke the agent; it countered at the defensible ${floor / 100}`);
  await decide(counter.id, "approve");
  const close = await nextMove(`We have paid £${(floor / 100).toFixed(2)} by bank transfer today.`, "agent to read the payment");
  assert(close.kind === "close_case", "payment reply woke the agent; it proposed closing as settled");
  await decide(close.id, "approve");
  state = await call(`/api/cases/${CASE_ID}`);
  assert(state.run.status === "completed" && state.case.status === "resolved", "negotiation settled and the case resolved");

  if (CHAIN) {
    const clean = await waitFor(async () => {
      const r = await call("/api/ledger/verify", { method: "POST", body: "{}" });
      return r.ok && r.chain.onChainCount === r.checked ? r : null;
    }, "all entries anchored");
    assert(clean.ok, `ledger verified: ${clean.checked} entries match on-chain anchors`);
  } else {
    const local = await call("/api/ledger/verify", { method: "POST", body: JSON.stringify({ caseId: CASE_ID }) });
    assert(local.ok, `hash chain verified: ${local.checked} entries intact (chain offline)`);
  }
  if (!TAMPER) {
    console.log("E2E smoke test passed (tamper step skipped).");
    return;
  }

  await call("/api/demo/tamper", { method: "POST", body: JSON.stringify({ caseId: CASE_ID }) });
  const tampered = await call("/api/ledger/verify", { method: "POST", body: "{}" });
  assert(!tampered.ok && tampered.entries.some((e) => e.onChain === "mismatch"), "tampering detected against the chain");
  console.log("E2E smoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
