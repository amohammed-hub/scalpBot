import { afterEach, beforeEach, describe, expect, it } from "vitest";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOBILE_AUTH_COOKIE_MAX_AGE_MS,
  MOBILE_AUTH_SESSION_SECONDS,
  getJwtSecret,
  getMobileAuthCookieOptions,
  signMobileAuthToken,
  verifyMobileAuthToken,
} from "./authSession";

const here = dirname(fileURLToPath(import.meta.url));
const routerSource = readFileSync(join(here, "routers.ts"), "utf8");
const gateSource = readFileSync(join(here, "_core/trpcAuthGate.ts"), "utf8");
const trpcSource = readFileSync(join(here, "_core/trpc.ts"), "utf8");
const protectedPages = [
  "Dashboard.tsx",
  "Settings.tsx",
  "Backtest.tsx",
  "HeroZeroScanner.tsx",
  "PnLAnalytics.tsx",
].map(name => readFileSync(join(here, "../client/src/pages", name), "utf8"));

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "persistent-railway-secret-for-regression";
});

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

describe("persistent 30-day auth sessions", () => {
  it("issues a token whose expiry is exactly 30 days after issuance", () => {
    const token = signMobileAuthToken({ userId: 7, mobile: "+919999999999", role: "user" });
    const decoded = jwt.decode(token) as JwtPayload;
    expect(decoded.exp).toBeTypeOf("number");
    expect(decoded.iat).toBeTypeOf("number");
    expect((decoded.exp as number) - (decoded.iat as number)).toBe(MOBILE_AUTH_SESSION_SECONDS);
    expect(verifyMobileAuthToken(token)).toMatchObject({ userId: 7, role: "user" });
  });

  it("keeps the browser cookie aligned to the 30-day JWT lifetime", () => {
    expect(MOBILE_AUTH_COOKIE_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(getMobileAuthCookieOptions()).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: MOBILE_AUTH_COOKIE_MAX_AGE_MS,
      path: "/",
    });
  });

  it("fails production startup when the persistent Railway secret is absent", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(() => getJwtSecret()).toThrow(/JWT_SECRET is required in production/);
  });

  it("contains no implicit fallback secret in any server authentication path", () => {
    expect(routerSource).not.toContain("fallback-secret");
    expect(gateSource).not.toContain("fallback-secret");
    expect(trpcSource).not.toContain("fallback-secret");
    expect(gateSource).toContain("getPersistentJwtSecret");
  });

  it("protected pages clear auth only after a successful explicit null response", () => {
    for (const source of protectedPages) {
      expect(source).toMatch(/isSuccess\s*&&\s*[^\n]*data\s*===\s*null/);
      expect(source).not.toMatch(/isFetched\s*&&\s*!\s*[^\n]*data/);
    }
  });
});
