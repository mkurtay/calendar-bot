import { createClerkClient, verifyToken } from "@clerk/backend";

/**
 * Verify a Clerk JWT and enforce the ALLOWED_EMAILS allow-list.
 *
 * Two gates apply, in order:
 *   1. Clerk-side: the token must be valid + unexpired + issued by our
 *      Clerk app. `verifyToken` does this.
 *   2. App-side: the verified user's primary email must be in our
 *      ALLOWED_EMAILS env var. Belt-and-suspenders since Clerk's
 *      allowlist feature is also configured upstream — we don't want
 *      a misconfigured Clerk dashboard to silently open the door.
 *
 * Clerk's default session JWT carries `sub` but NOT `email` (email is
 * a user-level attribute, not a session-level one). Rather than ask
 * the Clerk admin to customize the session-token template, we
 * resolve email server-side via `clerkClient.users.getUser(sub)`.
 * This adds one HTTP call per chat request (~80ms) but keeps the
 * allowlist authoritative against current Clerk user state on every
 * call — no token-cache staleness.
 *
 * Throws on failure. Returns the verified email + user id on success.
 */
export interface VerifiedUser {
  userId: string;
  email: string;
}

export async function verifyAuth(authHeader: string | undefined): Promise<VerifiedUser> {
  if (!authHeader) {
    throw new Error("Missing Authorization header");
  }
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  if (!token) {
    throw new Error("Authorization header must be `Bearer <jwt>`");
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY not configured");
  }

  const verified = await verifyToken(token, { secretKey });

  const userId = typeof verified.sub === "string" ? verified.sub : undefined;
  if (!userId) {
    throw new Error("Clerk token missing required claim (sub)");
  }

  // Fast path: if the Clerk dashboard's session-token template includes
  // an `email` (or `primary_email_address`) claim, use it directly and
  // skip the API hop. Default Clerk session tokens don't carry it; the
  // fallback below handles that case.
  const claims = verified as unknown as {
    email?: unknown;
    primary_email_address?: unknown;
  };
  const claimEmail =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.primary_email_address === "string"
        ? claims.primary_email_address
        : undefined;

  // Fallback: fetch the user from Clerk to read the primary email.
  // Singleton client across warm-container invocations.
  let email = claimEmail;
  if (!email) {
    const clerk = getClerkClient(secretKey);
    const user = await clerk.users.getUser(userId);
    const primaryEmailId = user.primaryEmailAddressId;
    const primaryEmail = user.emailAddresses.find((e) => e.id === primaryEmailId);
    email = primaryEmail?.emailAddress;
  }
  if (!email) {
    throw new Error(`Clerk user ${userId} has no primary email`);
  }

  const allowed = (process.env.ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(email.toLowerCase())) {
    throw new Error(`Email ${email} not in allowlist`);
  }

  return { userId, email };
}

let cachedClient: ReturnType<typeof createClerkClient> | null = null;
function getClerkClient(secretKey: string): ReturnType<typeof createClerkClient> {
  // Per-warm-container singleton. The backend client is heavy enough
  // (HTTP keep-alive, caches its own tokens) that re-creating it per
  // request would waste 20-50ms.
  if (!cachedClient) {
    cachedClient = createClerkClient({ secretKey });
  }
  return cachedClient;
}
