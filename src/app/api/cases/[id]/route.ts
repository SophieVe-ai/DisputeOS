import { connection } from "next/server";
import { fail, handle, ok } from "@/lib/api/http";
import { caseDetail } from "@/lib/api/views";

export async function GET(_request: Request, ctx: RouteContext<"/api/cases/[id]">) {
  await connection();
  const { id } = await ctx.params;
  return handle(() => {
    const detail = caseDetail(id);
    return detail ? ok(detail) : fail("Case not found", 404);
  });
}
