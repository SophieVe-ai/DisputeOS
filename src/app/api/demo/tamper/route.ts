import { fail, handle, ok, readJson } from "@/lib/api/http";
import { TamperSchema } from "@/lib/api/schemas";
import { config } from "@/lib/config";
import { tamperWithCase } from "@/lib/ledger/tamper";

/** DEMO ONLY — disabled when DEMO_MODE=0. Simulates an insider rewriting an agent's logged decision. */
export async function POST(request: Request) {
  const body = await readJson(request);
  return handle(async () => {
    if (!config.demoMode) return fail("Demo endpoints are disabled", 404);
    const { caseId } = TamperSchema.parse(body);
    const result = await tamperWithCase(caseId);
    return result ? ok(result) : fail("No completed agent output to tamper with yet — run the agents first", 409);
  });
}
