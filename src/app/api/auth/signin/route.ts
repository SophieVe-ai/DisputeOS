import type { NextRequest } from "next/server";
import { createSession, signIn } from "@/lib/auth/accounts";
import { publicUser } from "@/lib/api/account-view";
import { handle, ok, readJson } from "@/lib/api/http";
import { SignInSchema } from "@/lib/api/schemas";
import { setSessionCookie } from "@/lib/api/session";

export async function POST(request: NextRequest) {
  const body = await readJson(request);
  return handle(async () => {
    const { email, password } = SignInSchema.parse(body);
    const user = await signIn(email, password);
    const session = createSession(user.id);
    const res = ok({ user: publicUser(user) });
    setSessionCookie(res, session.token, session.expiresAt);
    return res;
  });
}
