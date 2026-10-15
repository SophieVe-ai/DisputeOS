import { connection } from "next/server";
import { handle, ok, readJson } from "@/lib/api/http";
import { NewCaseSchema } from "@/lib/api/schemas";
import { caseSummaries } from "@/lib/api/views";
import { appendEntry } from "@/lib/ledger/ledger";
import { kick } from "@/lib/orchestrator/drain";
import { createCase } from "@/lib/repo/cases";

export async function GET() {
  await connection();
  return handle(async () => ok(await caseSummaries()));
}

export async function POST(request: Request) {
  const body = await readJson(request);
  return handle(async () => {
    const input = NewCaseSchema.parse(body);
    const created = await createCase(input);
    await appendEntry({
      caseId: created.id,
      runId: null,
      actor: "system:intake",
      action: "case.opened",
      payload: { reference: created.reference, claimedAmountPence: created.claimedAmountPence, documents: input.documents.length },
    });
    kick(); // anchors the case.opened entry
    return ok(created, 201);
  });
}
