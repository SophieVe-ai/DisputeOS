import { connection } from "next/server";
import { fail, handle, ok } from "@/lib/api/http";
import { caseDetail } from "@/lib/api/views";
import { config } from "@/lib/config";
import { kick } from "@/lib/orchestrator/drain";
import { hasDueWork } from "@/lib/repo/wakeups";

/** Agent work started by this request keeps running after the response (see drain.ts). */
export const maxDuration = 300;

export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]">) {
  await connection();
  const { id } = await ctx.params;
  return handle(async () => {
    // The case page polls this; on Vercel a poll also picks up work that fell due (retries, timers).
    if (config.serverless && (await hasDueWork())) kick();
    const detail = await caseDetail(id);
    return detail ? ok(detail) : fail("Case not found", 404);
  });
}
