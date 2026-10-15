import type { NextRequest } from "next/server";
import { createSession, signUp } from "@/lib/auth/accounts";
import { publicUser } from "@/lib/api/account-view";
import { handle, ok, readJson } from "@/lib/api/http";
import { SignUpSchema } from "@/lib/api/schemas";
import { setSessionCookie } from "@/lib/api/session";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  return handle(async () => {
    const user = await signUp(SignUpSchema.parse(body));
    const session = createSession(user.id);
    const res = ok({ user: publicUser(user) }, 201);
    setSessionCookie(res, session.token, session.expiresAt);
    return res;
  });
}
