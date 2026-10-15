// End-to-end smoke test against a running stack (chain + deployed contract + Next server).
// Exercises the critical flow: upload documents → run agents → human approval →
// on-chain verification → tamper detection. The app starts empty, so the case comes
// from the Ashford sample pack through the real intake API.
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PACK_DIR = path.join(process.cwd(), "public", "samples", "ashford");
const TIMEOUT_MS = 90_000;

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
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function main() {
  console.log(`DisputeOS E2E smoke test → ${BASE}`);
  await waitFor(async () => (await call("/api/system")).chain.connected, "chain connection");
  assert(true, "app is up and connected to the AuditLog contract");

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
    if (d.run?.status === "failed") throw new Error(`run failed: ${d.run.error}`);
    return d.run?.status === "awaiting_approval" ? d : null;
  }, "agents to finish");
  assert(detail.steps.every((s) => s.status === "done"), "all four agents completed");
  assert(detail.proposals[0].kind === "issue_credit_note" && detail.proposals[0].amountPence === 61_400, "challenge caught our own £614 overcharge/short delivery");

  const approved = await call(`/api/proposals/${detail.proposals[0].id}/decision`, {
    method: "POST",
    body: JSON.stringify({ decision: "approve", approver: "CI Bot" }),
  });
  assert(approved.status === "executed", "approved action executed");

  const clean = await waitFor(async () => {
    const r = await call("/api/ledger/verify", { method: "POST", body: "{}" });
    return r.ok && r.chain.onChainCount === r.checked ? r : null;
  }, "all entries anchored");
  assert(clean.ok, `ledger verified: ${clean.checked} entries match on-chain anchors`);

  await call("/api/demo/tamper", { method: "POST", body: JSON.stringify({ caseId: CASE_ID }) });
  const tampered = await call("/api/ledger/verify", { method: "POST", body: "{}" });
  assert(!tampered.ok && tampered.entries.some((e) => e.onChain === "mismatch"), "tampering detected against the chain");
  console.log("E2E smoke test passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
