// User accounts and cookie sessions.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getDb, nowIso } from "../db";
import { hashPassword, verifyPassword } from "./password";

export type AccountType = "business" | "other";

export interface User {
  id: string;
  email: string;
  accountType: AccountType;
  businessName: string | null;
  createdAt: string;
}

export type SignUpInput =
  | { accountType: "business"; businessName: string; email: string; password: string }
  | { accountType: "other"; email: string; password: string };

/** Wrong email or password. Deliberately does not say which. */
export class InvalidCredentialsError extends Error {}
export class EmailTakenError extends Error {}

export const SESSION_COOKIE = "disputeos_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  account_type: AccountType;
  business_name: string | null;
  created_at: string;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  accountType: r.account_type,
  businessName: r.business_name,
  createdAt: r.created_at,
});

const normaliseEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Verified against when the email is unknown, so a miss takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;

export async function signUp(input: SignUpInput): Promise<User> {
  const email = normaliseEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const user: User = {
    id: randomUUID(),
    email,
    accountType: input.accountType,
    businessName: input.accountType === "business" ? input.businessName.trim() : null,
    createdAt: nowIso(),
  };
  try {
    getDb()
      .prepare("INSERT INTO users (id, email, password_hash, account_type, business_name, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(user.id, user.email, passwordHash, user.accountType, user.businessName, user.createdAt);
  } catch (err) {
    if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") throw new EmailTakenError("An account with this email already exists");
    throw err;
  }
  return user;
}

export async function signIn(email: string, password: string): Promise<User> {
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(normaliseEmail(email)) as UserRow | undefined;
  if (!row) {
    dummyHash ??= hashPassword("not-a-real-password");
    await verifyPassword(password, await dummyHash);
    throw new InvalidCredentialsError("Incorrect email or password");
  }
  if (!(await verifyPassword(password, row.password_hash))) throw new InvalidCredentialsError("Incorrect email or password");
  return toUser(row);
}

export function getUser(id: string): User | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

/** Starts a session and returns the token to put in the cookie. */
export function createSession(userId: string, now: Date = new Date()): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  getDb()
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, now.toISOString(), expiresAt.toISOString());
  return { token, expiresAt };
}

export function getSessionUser(token: string | null | undefined, now: Date = new Date()): User | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now.toISOString()) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function deleteSession(token: string | null | undefined): void {
  if (!token) return;
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}
