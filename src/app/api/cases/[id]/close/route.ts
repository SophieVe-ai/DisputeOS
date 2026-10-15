import { fail, handle, ok, readJson } from "@/lib/api/http";
import { CloseEngagementSchema } from "@/lib/api/schemas";
import { closeEngagement } from "@/lib/orchestrator/engagement";
import { getCase } from "@/lib/repo/cases";

/** A human stops the follow-up and closes the case. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/close">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  return handle(async () => {
    if (!(await getCase(id))) return fail("Case not found", 404);
    const { closedBy } = CloseEngagementSchema.parse(body);
    return ok(await closeEngagement(id, closedBy));
  });
}
