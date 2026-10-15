import { fail, handle, ok, readJson } from "@/lib/api/http";
import { StartRunSchema } from "@/lib/api/schemas";
import { startRun } from "@/lib/orchestrator/runner";
import { getCase } from "@/lib/repo/cases";

export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/runs">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  return handle(() => {
    if (!getCase(id)) return fail("Case not found", 404);
    const { requestedBy } = StartRunSchema.parse(body);
    return ok(startRun(id, requestedBy), 202);
  });
}
