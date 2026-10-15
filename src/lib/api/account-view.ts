import type { User } from "../auth/accounts";

/** What the browser is told about the signed-in user. */
export function publicUser(user: User) {
  return { id: user.id, email: user.email, accountType: user.accountType, businessName: user.businessName };
}

export type PublicUser = ReturnType<typeof publicUser>;
