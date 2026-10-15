import { connection } from "next/server";
import { handle, ok, readJson } from "@/lib/api/http";
import { NewCaseSchema } from "@/lib/api/schemas";
import { caseSummaries } from "@/lib/api/views";
import { appendEntry } from "@/lib/ledger/ledger";
import { createCase } from "@/lib/repo/cases";

export async function GET() {
  await connection();
  return handle(() => ok(caseSummaries()));
}

export async function POST(request: Request) {
  const body = await readJson(request);
  return handle(() => {
    const input = NewCaseSchema.parse(body);
    const created = createCase(input);
    appendEntry({
      caseId: created.id,
      runId: null,
      actor: "system:intake",
      action: "case.opened",
      payload: { reference: created.reference, claimedAmountPence: created.claimedAmountPence, documents: input.documents.length },
    });
    return ok(created, 201);
  });
}
