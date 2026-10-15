import { connection, type NextRequest } from "next/server";
import { handle, ok } from "@/lib/api/http";
import { listEntries } from "@/lib/ledger/ledger";

export async function GET(request: NextRequest) {
  await connection();
  const caseId = request.nextUrl.searchParams.get("caseId") ?? undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 500);
  return handle(() => ok(listEntries({ caseId, limit: Number.isFinite(limit) ? limit : 500 })));
}
