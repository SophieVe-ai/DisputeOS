import { fail, handle, ok, readJson } from "@/lib/api/http";
import { ReplySchema } from "@/lib/api/schemas";
import { recordReply } from "@/lib/orchestrator/engagement";
import { getCase } from "@/lib/repo/cases";

/** Records a reply from the debtor and wakes the Negotiation agent. Also the target for an inbound-email webhook. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/replies">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  return handle(() => {
    if (!getCase(id)) return fail("Case not found", 404);
    const input = ReplySchema.parse(body);
    return ok(recordReply(id, input), 202);
  });
}
