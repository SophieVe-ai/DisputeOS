import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { freshEnvironment } from "@/test/helpers";
import { POST as signInRoute } from "@/app/api/auth/signin/route";
import { POST as signOutRoute } from "@/app/api/auth/signout/route";
import { POST as signUpRoute } from "@/app/api/auth/signup/route";
import { GET as meRoute } from "@/app/api/auth/me/route";
import { SignUpSchema } from "../api/schemas";
import {
  createSession,
  deleteSession,
  EmailTakenError,
  getSessionUser,
  InvalidCredentialsError,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signIn,
  signUp,
} from "./accounts";
import { hashPassword, verifyPassword } from "./password";

const BUSINESS = { accountType: "business" as const, businessName: "Northbank Print Co", email: "Priya@Northbank-Print.example", password: "correct horse" };

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("s3cret-pass");
    const b = await hashPassword("s3cret-pass");
    expect(a).not.toBe(b);
    expect(a).not.toContain("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", a)).toBe(true);
    expect(await verifyPassword("wrong-pass", a)).toBe(false);
    expect(await verifyPassword("s3cret-pass", "garbage")).toBe(false);
  });
});

describe("sign-up validation", () => {
  it("requires a business name and email for business accounts", () => {
    expect(() => SignUpSchema.parse({ accountType: "business", email: "a@acme.example", password: "12345678" })).toThrow(/Enter your business name/);
    expect(() => SignUpSchema.parse({ accountType: "business", businessName: "Acme", password: "12345678" })).toThrow(ZodError);
  });

  it("rejects personal email providers for business accounts but allows them for other accounts", () => {
    expect(() => SignUpSchema.parse({ ...BUSINESS, email: "priya@gmail.com" })).toThrow(/business email/);
    expect(SignUpSchema.parse({ accountType: "other", email: "priya@gmail.com", password: "12345678" }).email).toBe("priya@gmail.com");
  });

  it("normalises email and rejects short passwords and unknown account types", () => {
    expect(SignUpSchema.parse({ ...BUSINESS, email: "  Priya@Northbank-Print.EXAMPLE " }).email).toBe("priya@northbank-print.example");
    expect(() => SignUpSchema.parse({ ...BUSINESS, password: "short" })).toThrow(/at least 8/);
    expect(() => SignUpSchema.parse({ ...BUSINESS, accountType: "admin" })).toThrow(ZodError);
  });
});

describe("accounts and sessions", () => {
  beforeEach(async () => {
    await freshEnvironment();
  });

  it("creates business and other accounts", async () => {
    const biz = await signUp(SignUpSchema.parse(BUSINESS));
    expect(biz).toMatchObject({ accountType: "business", businessName: "Northbank Print Co", email: "priya@northbank-print.example" });
    const other = await signUp({ accountType: "other", email: "sam@gmail.com", password: "12345678" });
    expect(other.businessName).toBeNull();
  });

  it("refuses a second account with the same email, whatever its case", async () => {
    await signUp(SignUpSchema.parse(BUSINESS));
    await expect(signUp({ accountType: "other", email: "PRIYA@northbank-print.example", password: "12345678" })).rejects.toThrow(EmailTakenError);
  });

  it("signs in with the right password only, without revealing whether the email exists", async () => {
    await signUp(SignUpSchema.parse(BUSINESS));
    expect((await signIn("PRIYA@northbank-print.example", BUSINESS.password)).businessName).toBe("Northbank Print Co");
    await expect(signIn(BUSINESS.email, "wrong password")).rejects.toThrow("Incorrect email or password");
    await expect(signIn("nobody@example.com", "whatever")).rejects.toThrow(InvalidCredentialsError);
  });

  it("resolves sessions until they expire or are deleted", async () => {
    const user = await signUp(SignUpSchema.parse(BUSINESS));
    const now = new Date("2026-10-15T12:00:00Z");
    const { token } = await createSession(user.id, now);
    expect((await getSessionUser(token, now))?.id).toBe(user.id);
    expect(await getSessionUser(token, new Date(now.getTime() + SESSION_TTL_MS + 1))).toBeNull();
    expect(await getSessionUser("forged", now)).toBeNull();
    expect(await getSessionUser(null, now)).toBeNull();
    await deleteSession(token);
    expect(await getSessionUser(token, now)).toBeNull();
  });
});

describe("auth routes", () => {
  beforeEach(async () => {
    await freshEnvironment();
  });

  const post = (body: unknown, cookie?: string) =>
    new NextRequest("http://localhost/api/auth", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    });
  const me = (cookie?: string) => new NextRequest("http://localhost/api/auth/me", { headers: cookie ? { cookie } : {} });
  const sessionCookie = (res: Response) => {
    const header = res.headers.get("set-cookie") ?? "";
    return { header, pair: header.split(";")[0] };
  };

  it("signs up, stays signed in via an httpOnly cookie, signs out", async () => {
    const res = await signUpRoute(post(BUSINESS));
    expect(res.status).toBe(201);
    const { header, pair } = sessionCookie(res);
    expect(pair.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=lax/i);

    const who = await (await meRoute(me(pair))).json();
    expect(who.data.user).toMatchObject({ email: "priya@northbank-print.example", accountType: "business", businessName: "Northbank Print Co" });
    expect(who.data.user).not.toHaveProperty("passwordHash");

    const out = await signOutRoute(post({}, pair));
    expect(sessionCookie(out).header).toMatch(/Max-Age=0/i);
    expect((await (await meRoute(me(pair))).json()).data.user).toBeNull();
  });

  it("returns clear errors for bad input, taken emails and wrong passwords", async () => {
    expect((await signUpRoute(post({ ...BUSINESS, email: "priya@gmail.com" }))).status).toBe(400);
    expect((await signUpRoute(post(BUSINESS))).status).toBe(201);
    expect((await signUpRoute(post(BUSINESS))).status).toBe(409);

    const bad = await signInRoute(post({ email: BUSINESS.email, password: "nope-nope" }));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();

    const good = await signInRoute(post({ email: BUSINESS.email, password: BUSINESS.password }));
    expect(good.status).toBe(200);
    expect(sessionCookie(good).pair.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
  });

  it("reports no user when signed out", async () => {
    expect((await (await meRoute(me())).json()).data.user).toBeNull();
  });
});
