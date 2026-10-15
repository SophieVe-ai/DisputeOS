import { fail, handle, ok, readJson } from "@/lib/api/http";
import { FastForwardSchema } from "@/lib/api/schemas";
import { config } from "@/lib/config";
import { fastForward } from "@/lib/orchestrator/engagement";

/** DEMO ONLY — disabled when DEMO_MODE=0. Fires the next follow-up deadline now; logged on the ledger. */
export async function POST(request: Request) {
  const body = await readJson(request);
  return handle(() => {
    if (!config.demoMode) return fail("Demo endpoints are disabled", 404);
    const { caseId } = FastForwardSchema.parse(body);
    const wakeup = fastForward(caseId);
    return wakeup ? ok(wakeup) : fail("No follow-up deadline is scheduled for this case", 409);
  });
}
