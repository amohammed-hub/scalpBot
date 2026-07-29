import jwt from "jsonwebtoken";

export const MOBILE_AUTH_SESSION_DAYS = 30;
export const MOBILE_AUTH_SESSION_SECONDS = MOBILE_AUTH_SESSION_DAYS * 24 * 60 * 60;
export const MOBILE_AUTH_COOKIE_MAX_AGE_MS = MOBILE_AUTH_SESSION_SECONDS * 1000;

export type MobileAuthClaims = {
  userId: number;
  mobile: string;
  role: string;
};

export type AdminAuthClaims = {
  role: "admin";
  isAdmin: true;
};

/**
 * Return the one stable signing secret used by every auth path.
 * Production must never mint tokens with an implicit process-local fallback:
 * a missing Railway variable now prevents startup instead of logging everyone
 * out after the next process replacement.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET is required in production and must persist across deployments");
  }

  return "scalpbot-local-test-jwt-secret";
}

export function assertPersistentJwtConfiguration(): void {
  getJwtSecret();
}

export function signMobileAuthToken(claims: MobileAuthClaims): string {
  return jwt.sign(claims, getJwtSecret(), { expiresIn: MOBILE_AUTH_SESSION_SECONDS });
}

export function verifyMobileAuthToken(token: string): MobileAuthClaims {
  return jwt.verify(token, getJwtSecret()) as MobileAuthClaims;
}

export function signAdminAuthToken(claims: AdminAuthClaims): string {
  return jwt.sign(claims, getJwtSecret(), { expiresIn: MOBILE_AUTH_SESSION_SECONDS });
}

export function getMobileAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: MOBILE_AUTH_COOKIE_MAX_AGE_MS,
    path: "/",
  };
}
