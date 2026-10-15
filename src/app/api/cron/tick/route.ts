import { fail, handle, ok } from "@/lib/api/http";
import { config } from "@/lib/config";
import { drain } from "@/lib/orchestrator/drain";

/** Vercel Cron backstop: fires overdue follow-up timers and resumes any interrupted work. */
export const maxDuration = 300;

export async function GET(request: Request) {
  return handle(async () => {
    // Vercel sends `Authorization: Bearer $CRON_SECRET`. Required whenever we run on Vercel.
    const expected = config.cronSecret;
    if (config.serverless && !expected) return fail("CRON_SECRET is not configured", 503);
    if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) return fail("Unauthorized", 401);
    return ok(await drain());
  });
}
