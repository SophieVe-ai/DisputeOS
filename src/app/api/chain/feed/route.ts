import { connection, type NextRequest } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { chainFeed } from "@/lib/ledger/chain-feed";

export async function GET(request: NextRequest) {
  await connection();
  const caseId = request.nextUrl.searchParams.get("caseId") ?? undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 80);
  return handle(async () => ok(await chainFeed({ caseId, limit: Number.isFinite(limit) ? limit : 80 })));
}
