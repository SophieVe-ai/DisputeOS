import { handle, ok, readJson } from "@/lib/api/http";
import { DecisionSchema } from "@/lib/api/schemas";
import { decideProposal } from "@/lib/orchestrator/approvals";

export async function POST(request: Request, ctx: RouteContext<"/api/proposals/[id]/decision">) {
  const { id } = await ctx.params;
  const body = await readJson(request);
  return handle(() => {
    const input = DecisionSchema.parse(body);
    return ok(decideProposal({ proposalId: id, ...input }));
  });
}
