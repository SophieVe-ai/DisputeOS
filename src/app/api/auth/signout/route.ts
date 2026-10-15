import type { NextRequest } from "next/server";
import { deleteSession } from "@/lib/auth/accounts";
import { handle, ok } from "@/lib/api/http";
import { clearSessionCookie, sessionToken } from "@/lib/api/session";

export async function POST(request: NextRequest) {
  return handle(() => {
    deleteSession(sessionToken(request));
    const res = ok({ signedOut: true });
    clearSessionCookie(res);
    return res;
  });
}
