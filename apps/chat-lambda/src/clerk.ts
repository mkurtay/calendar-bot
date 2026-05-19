import { verifyToken } from "@clerk/backend";

/**
 * Verify a Clerk JWT and enforce the ALLOWED_EMAILS allow-list.
 *
 * Two gates apply, in order:
 *   1. Clerk-side: the token must be valid + unexpired + issued by our
 *      Clerk app. `verifyToken` does this.
 *   2. App-side: the verified token's primary email must be in our
 *      ALLOWED_EMAILS env var. Belt-and-suspenders since Clerk's
 *      allowlist feature is also configured upstream — we don't want
 *      a misconfigured Clerk dashboard to silently open the door.
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

  // Clerk JWT claims:
  //   sub: user id
  //   email: primary email (Clerk includes by default for session tokens)
  const userId = typeof verified.sub === "string" ? verified.sub : undefined;
  const claims = verified as unknown as {
    email?: unknown;
    primary_email_address?: unknown;
  };
  const email =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.primary_email_address === "string"
        ? claims.primary_email_address
        : undefined;

  if (!userId || !email) {
    throw new Error("Clerk token missing required claims (sub, email)");
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
