import { handle, ok, readJson } from "@/lib/api/http";
import { VerifySchema } from "@/lib/api/schemas";
import { syncAnchors, verifyLedger } from "@/lib/ledger/ledger";

export async function POST(request: Request) {
  const body = await readJson(request);
  return handle(async () => {
    const { caseId } = VerifySchema.parse(body);
    await syncAnchors();
    return ok(await verifyLedger(caseId));
  });
}
