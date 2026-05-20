import { verifyToken } from "@clerk/backend";

/**
 * Verify a Clerk JWT and return the authenticated user id.
 *
 * Single gate now: a valid, unexpired Clerk session token issued by
 * our Clerk app. Authorization beyond that is handled upstream by
 * Clerk's waitlist — new signups can't reach the chat without manual
 * admin approval in the Clerk dashboard.
 *
 * Earlier this also enforced an ALLOWED_EMAILS allowlist by looking
 * up the user via the Clerk Backend API. That gate was redundant once
 * the waitlist was enabled, and removing it saves ~80ms per request
 * (no more cross-service Clerk API call).
 *
 * Throws on failure. Returns the verified Clerk user id on success.
 */
export interface VerifiedUser {
  userId: string;
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

  return { userId };
}
