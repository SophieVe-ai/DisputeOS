import { connection } from "next/server";
import { handle, ok, readJson } from "@/lib/api/http";
import { StartRunSchema } from "@/lib/api/schemas";
import { getEvalState, startEval } from "@/lib/eval/service";

export async function GET() {
  await connection();
  return handle(() => ok(getEvalState()));
}

/** Starts an eval in the background; poll GET for the result. */
export async function POST(request: Request) {
  const body = await readJson(request);
  return handle(() => {
    const { requestedBy } = StartRunSchema.parse(body);
    startEval(requestedBy).catch(() => {
      // Recorded in eval state; surfaced to the client via GET.
    });
    return ok(getEvalState(), 202);
  });
}
