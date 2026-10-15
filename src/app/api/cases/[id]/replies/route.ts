import { fail, handle, ok, readJson } from "@/lib/api/http";
import { ReplySchema } from "@/lib/api/schemas";
import { kick } from "@/lib/orchestrator/drain";
import { recordReply } from "@/lib/orchestrator/engagement";
import { getCase } from "@/lib/repo/cases";

/** Agent work started by this request keeps running after the response (see drain.ts). */
export const maxDuration = 300;

/** Records a reply from the debtor and wakes the Negotiation agent. Also the target for an inbound-email webhook. */
export async function POST(request: Request, ctx: RouteContext<"/api/cases/[id]/replies">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  return handle(async () => {
    if (!(await getCase(id))) return fail("Case not found", 404);
    const input = ReplySchema.parse(body);
    const recorded = await recordReply(id, input);
    kick(); // wake the Negotiation agent now
    return ok(recorded, 202);
  });
}
