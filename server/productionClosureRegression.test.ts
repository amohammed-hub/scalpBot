import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSignalJournalRegime } from "../shared/signalJournalState";
import { classifyUpstoxAuthorizationHttpStatus } from "../shared/upstoxTokenState";
import {
  getBaseBotSessionToken,
  selectCanonicalBrokerSession,
  selectOrphanScanOnlyBaseSessions,
  type BrokerSessionCandidate,
} from "../shared/upstoxSessionReconciliation";
import { deriveBrokerSessionIdentity, extractUpstoxProfileUserId } from "./upstoxSessionIdentity";

const here = dirname(fileURLToPath(import.meta.url));
const dbSource = readFileSync(join(here, "db.ts"), "utf8");
const restartSource = readFileSync(join(here, "botRestart.ts"), "utf8");
const precisionSource = readFileSync(join(here, "precisionMetrics.ts"), "utf8");

describe("30 July production closure regressions", () => {
  describe("precision signal journal", () => {
    it("maps the production overflow label to a bounded canonical regime", () => {
      expect(normalizeSignalJournalRegime("Ranging — use VWAP mean reversion")).toBe("ranging");
      expect(normalizeSignalJournalRegime("Trending strongly")).toBe("trending");
      expect(normalizeSignalJournalRegime("High volatility breakout")).toBe("high_vol");
      expect(normalizeSignalJournalRegime("Low vol compression")).toBe("low_vol");
      expect(normalizeSignalJournalRegime("Insufficient candles")).toBe("unknown");
    });

    it("preserves short unknown labels, bounds long labels to VARCHAR(32), and keeps absence null", () => {
      expect(normalizeSignalJournalRegime("custom")).toBe("custom");
      expect(normalizeSignalJournalRegime("x".repeat(64))).toHaveLength(32);
      expect(normalizeSignalJournalRegime("   ")).toBeNull();
      expect(normalizeSignalJournalRegime(null)).toBeNull();
    });

    it("normalizes at the sole database write boundary", () => {
      expect(precisionSource).toContain("regime: normalizeSignalJournalRegime(entry.regime)");
    });
  });

  describe("persisted bot ownership and startup authorization", () => {
    it("migrates the base token and every supported slot including the fifth card", () => {
      expect(dbSource).toContain("for (let slot = 0; slot <= 8; slot += 1)");
      expect(dbSource).toContain('const suffix = slot === 0 ? "" : `-slot${slot}`');
      expect(dbSource).toContain("[upstoxCredentials, botSessions, tradeLog, signalJournal]");
      expect(dbSource).not.toContain('oldToken + "-slot3"');
    });

    it("classifies only explicit credential failures as authorization blockers", () => {
      expect(classifyUpstoxAuthorizationHttpStatus(200, true)).toBe("valid");
      expect(classifyUpstoxAuthorizationHttpStatus(204, true)).toBe("valid");
      expect(classifyUpstoxAuthorizationHttpStatus(401, true)).toBe("unauthorized");
      expect(classifyUpstoxAuthorizationHttpStatus(403, true)).toBe("unauthorized");
      expect(classifyUpstoxAuthorizationHttpStatus(429, true)).toBe("indeterminate");
      expect(classifyUpstoxAuthorizationHttpStatus(503, true)).toBe("indeterminate");
      expect(classifyUpstoxAuthorizationHttpStatus(null, true)).toBe("indeterminate");
      expect(classifyUpstoxAuthorizationHttpStatus(200, false)).toBe("missing");
    });

    it("derives one normalized identity from documented and wrapped Upstox profile payloads", () => {
      const documented = deriveBrokerSessionIdentity(
        { status: "success", data: { user_id: " ab1234 " } },
        "first-access-token",
      );
      const wrapped = deriveBrokerSessionIdentity(
        JSON.stringify({ result: { profile: { userId: "AB1234" } } }),
        "second-access-token",
      );

      expect(documented).toEqual({
        key: "profile-user-id:AB1234",
        source: "profile-user-id",
      });
      expect(wrapped).toEqual(documented);
      expect(extractUpstoxProfileUserId({ data: { user_id: 12345 } })).toBe("12345");
    });

    it("uses a deterministic non-reversible exact credential identity only when profile user_id is unavailable", () => {
      const first = deriveBrokerSessionIdentity({ status: "success", data: {} }, "secret-access-token");
      const same = deriveBrokerSessionIdentity({ unexpected: true }, " secret-access-token ");
      const different = deriveBrokerSessionIdentity({}, "different-access-token");

      expect(first?.source).toBe("credential-fingerprint");
      expect(first?.key).toMatch(/^credential-sha256:[a-f0-9]{64}$/);
      expect(first?.key).not.toContain("secret-access-token");
      expect(same?.key).toBe(first?.key);
      expect(different?.key).not.toBe(first?.key);
      expect(deriveBrokerSessionIdentity({}, "   ")).toBeNull();
    });

    it("uses only session-owned credentials and stops definitive orphan sessions before engine creation", () => {
      expect(restartSource).toContain('upstoxAxios.get("https://api.upstox.com/v2/user/profile"');
      expect(restartSource).toContain('authorizationState === "missing" || authorizationState === "unauthorized"');
      expect(restartSource).toContain('set({ status: "stopped", lastError })');
      expect(restartSource).not.toContain("FALLBACK: Migrated credentials");
      expect(restartSource).not.toContain("select().from(upstoxCredentials).limit(10)");
    });

    it("selects one canonical session per verified broker identity with open-trade safety first", () => {
      const candidates: BrokerSessionCandidate[] = [
        {
          baseSessionToken: "durable-current",
          brokerIdentityKey: "broker-user",
          hasOpenTrade: false,
          isDurableUserSession: true,
          latestUpdatedAtMs: 200,
        },
        {
          baseSessionToken: "historical-protecting-trade",
          brokerIdentityKey: "broker-user",
          hasOpenTrade: true,
          isDurableUserSession: false,
          latestUpdatedAtMs: 100,
        },
      ];
      expect(selectCanonicalBrokerSession(candidates)?.baseSessionToken).toBe("historical-protecting-trade");
    });

    it("prefers the durable app-user session, then recency, when no open trade needs protection", () => {
      const durable: BrokerSessionCandidate = {
        baseSessionToken: "durable-current",
        brokerIdentityKey: "broker-user",
        hasOpenTrade: false,
        isDurableUserSession: true,
        latestUpdatedAtMs: 100,
      };
      const newerTransient: BrokerSessionCandidate = {
        baseSessionToken: "newer-transient",
        brokerIdentityKey: "broker-user",
        hasOpenTrade: false,
        isDurableUserSession: false,
        latestUpdatedAtMs: 200,
      };
      expect(selectCanonicalBrokerSession([newerTransient, durable])?.baseSessionToken).toBe("durable-current");
      expect(selectCanonicalBrokerSession([
        { ...durable, isDurableUserSession: false },
        newerTransient,
      ])?.baseSessionToken).toBe("newer-transient");
    });

    it("identifies only durable-user-orphan scan sessions and always preserves open-trade owners", () => {
      expect(selectOrphanScanOnlyBaseSessions([
        { baseSessionToken: "durable-current", isDurableUserSession: true, hasOpenTrade: false },
        { baseSessionToken: "orphan-scan", isDurableUserSession: false, hasOpenTrade: false },
        { baseSessionToken: "orphan-protecting-trade", isDurableUserSession: false, hasOpenTrade: true },
        { baseSessionToken: "orphan-scan", isDurableUserSession: false, hasOpenTrade: false },
      ])).toEqual(["orphan-scan"]);
    });

    it("groups base and slot tokens consistently and decommissions unsafe duplicate rows before restart", () => {
      expect(getBaseBotSessionToken("base-token-slot4")).toBe("base-token");
      expect(getBaseBotSessionToken("base-token")).toBe("base-token");
      expect(restartSource).toContain("reconcileDuplicateBrokerSessions(runningSessions)");
      expect(restartSource).toContain("selectOrphanScanOnlyBaseSessions");
      expect(restartSource).toContain('persisted scan-only session is not owned by a durable app user');
      expect(restartSource).toContain('authorization.state !== "valid" || !authorization.brokerIdentity');
      expect(restartSource).toContain("deriveBrokerSessionIdentity(response.data, accessToken)");
      expect(restartSource).toContain('authorization.brokerIdentity.source === "credential-fingerprint"');
      expect(restartSource).toContain("duplicate.hasOpenTrade");
      expect(restartSource).toContain('duplicate persisted session for the same Upstox account; canonical session selected');
      expect(restartSource.indexOf("const orphanBaseSessionTokens")).toBeLessThan(
        restartSource.indexOf("const candidatesByBrokerIdentity"),
      );
      expect(restartSource.indexOf("reconcileDuplicateBrokerSessions(runningSessions)")).toBeLessThan(
        restartSource.indexOf("for (const session of reconciledSessions)"),
      );
    });
  });
});
