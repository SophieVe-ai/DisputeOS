import { fail, handle, ok, readJson } from "@/lib/api/http";
import { StartRunSchema } from "@/lib/api/schemas";
import { kick } from "@/lib/orchestrator/drain";
import { startRun } from "@/lib/orchestrator/runner";
import { getCase } from "@/lib/repo/cases";

/** Agent work started by this request keeps running after the response (see drain.ts). */
export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/runs">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  return handle(async () => {
    if (!(await getCase(id))) return fail("Case not found", 404);
    const { requestedBy } = StartRunSchema.parse(body);
    const run = await startRun(id, requestedBy);
    kick();
    return ok(run, 202);
  });
}
