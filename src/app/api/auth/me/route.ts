import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/accounts";
import { publicUser } from "@/lib/api/account-view";
import { handle, ok } from "@/lib/api/http";
import { sessionToken } from "@/lib/api/session";

export async function GET(request: NextRequest) {
  return handle(() => {
    const user = getSessionUser(sessionToken(request));
    return ok({ user: user ? publicUser(user) : null });
  });
}
