import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";

// Test the auth middleware logic (extracted for unit testing)
const JWT_SECRET = "test-secret-key";

const PUBLIC_TRPC_PROCEDURES = new Set([
  "mobileAuth.sendOtp",
  "mobileAuth.verifyOtp",
  "mobileAuth.me",
  "mobileAuth.updateName",
  "mobileAuth.logout",
  "auth.me",
  "auth.logout",
  "admin.login",
  "admin.verify",
  "subscription.checkAccess",
  "subscription.startTrial",
  "subscription.createOrder",
  "subscription.verifyPayment",
  "referral.applyCode",
  "referral.myReferral",
  "system.health",
]);

function shouldBlockRequest(path: string, token: string | undefined): { blocked: boolean; reason?: string } {
  const procedurePath = path.replace(/^\//, "");
  if (!procedurePath) return { blocked: false };

  const procedures = procedurePath.split(",").map(p => p.trim());
  const allPublic = procedures.every(p => PUBLIC_TRPC_PROCEDURES.has(p));
  if (allPublic) return { blocked: false };

  if (!token) return { blocked: true, reason: "no_token" };

  try {
    jwt.verify(token, JWT_SECRET);
    return { blocked: false };
  } catch {
    return { blocked: true, reason: "invalid_token" };
  }
}

describe("Auth Middleware — tRPC Gate", () => {
  it("allows public procedures without any token", () => {
    expect(shouldBlockRequest("mobileAuth.me", undefined).blocked).toBe(false);
    expect(shouldBlockRequest("mobileAuth.sendOtp", undefined).blocked).toBe(false);
    expect(shouldBlockRequest("subscription.checkAccess", undefined).blocked).toBe(false);
    expect(shouldBlockRequest("auth.me", undefined).blocked).toBe(false);
  });

  it("blocks sensitive procedures without a token", () => {
    expect(shouldBlockRequest("multiBots.allStatus", undefined).blocked).toBe(true);
    expect(shouldBlockRequest("bot.start", undefined).blocked).toBe(true);
    expect(shouldBlockRequest("trades.list", undefined).blocked).toBe(true);
    expect(shouldBlockRequest("credentials.get", undefined).blocked).toBe(true);
    expect(shouldBlockRequest("bot.status", undefined).blocked).toBe(true);
  });

  it("blocks batch requests if ANY procedure is non-public", () => {
    expect(shouldBlockRequest("mobileAuth.me,multiBots.allStatus", undefined).blocked).toBe(true);
    expect(shouldBlockRequest("subscription.checkAccess,bot.start", undefined).blocked).toBe(true);
  });

  it("allows batch requests if ALL procedures are public", () => {
    expect(shouldBlockRequest("mobileAuth.me,auth.me", undefined).blocked).toBe(false);
    expect(shouldBlockRequest("subscription.checkAccess,mobileAuth.sendOtp", undefined).blocked).toBe(false);
  });

  it("allows sensitive procedures with a valid JWT", () => {
    const token = jwt.sign({ userId: 1, mobile: "9876543210", role: "admin" }, JWT_SECRET, { expiresIn: "24h" });
    expect(shouldBlockRequest("multiBots.allStatus", token).blocked).toBe(false);
    expect(shouldBlockRequest("bot.start", token).blocked).toBe(false);
    expect(shouldBlockRequest("trades.list", token).blocked).toBe(false);
  });

  it("blocks sensitive procedures with an invalid/expired JWT", () => {
    const expiredToken = jwt.sign({ userId: 1 }, JWT_SECRET, { expiresIn: "-1h" });
    expect(shouldBlockRequest("multiBots.allStatus", expiredToken).blocked).toBe(true);
    expect(shouldBlockRequest("multiBots.allStatus", expiredToken).reason).toBe("invalid_token");
  });

  it("blocks sensitive procedures with a JWT signed by wrong secret", () => {
    const wrongToken = jwt.sign({ userId: 1 }, "wrong-secret", { expiresIn: "24h" });
    expect(shouldBlockRequest("multiBots.allStatus", wrongToken).blocked).toBe(true);
    expect(shouldBlockRequest("multiBots.allStatus", wrongToken).reason).toBe("invalid_token");
  });

  it("blocks sensitive procedures with a random string as token", () => {
    expect(shouldBlockRequest("multiBots.allStatus", "random-garbage-string").blocked).toBe(true);
    expect(shouldBlockRequest("multiBots.allStatus", "random-garbage-string").reason).toBe("invalid_token");
  });

  it("handles empty path gracefully", () => {
    expect(shouldBlockRequest("", undefined).blocked).toBe(false);
    expect(shouldBlockRequest("/", undefined).blocked).toBe(false);
  });
});
