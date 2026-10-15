import { after, connection } from "next/server";
import { handle, ok, readJson } from "@/lib/api/http";
import { StartRunSchema } from "@/lib/api/schemas";
import { getEvalState, startEval } from "@/lib/eval/service";

export async function GET() {
  await connection();
  return handle(async () => ok(await getEvalState()));
}

/** The eval keeps running after the response (it takes a few seconds offline, longer with Claude). */
export const maxDuration = 300;

/** Starts an eval in the background; poll GET for the result. */
export async function POST(request: Request) {
  const body = await readJson(request);
  return handle(async () => {
    const { requestedBy } = StartRunSchema.parse(body);
    const running = startEval(requestedBy).catch(() => {
      // Recorded in eval_runs; surfaced to the client via GET.
    });
    after(() => running);
    return ok({ ...(await getEvalState()), running: true }, 202);
  });
}
