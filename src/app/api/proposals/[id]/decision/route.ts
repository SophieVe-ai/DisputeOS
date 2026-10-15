import { handle, ok, readJson } from "@/lib/api/http";
import { DecisionSchema } from "@/lib/api/schemas";
import { decideProposal } from "@/lib/orchestrator/approvals";
import { kick } from "@/lib/orchestrator/drain";

/** Agent work started by this request keeps running after the response (see drain.ts). */
export const maxDuration = 300;

export async function POST(request: Request, ctx: RouteContext<"/api/proposals/[id]/decision">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  return handle(async () => {
    const input = DecisionSchema.parse(body);
    const decided = await decideProposal({ proposalId: id, ...input });
    kick(); // anchors the decision and runs any queued reply
    return ok(decided);
  });
}
