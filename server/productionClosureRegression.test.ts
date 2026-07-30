import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSignalJournalRegime } from "../shared/signalJournalState";
import { classifyUpstoxAuthorizationHttpStatus } from "../shared/upstoxTokenState";
import {
  getBaseBotSessionToken,
  selectCanonicalBrokerSession,
  type BrokerSessionCandidate,
} from "../shared/upstoxSessionReconciliation";

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
          brokerUserId: "broker-user",
          hasOpenTrade: false,
          isDurableUserSession: true,
          latestUpdatedAtMs: 200,
        },
        {
          baseSessionToken: "historical-protecting-trade",
          brokerUserId: "broker-user",
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
        brokerUserId: "broker-user",
        hasOpenTrade: false,
        isDurableUserSession: true,
        latestUpdatedAtMs: 100,
      };
      const newerTransient: BrokerSessionCandidate = {
        baseSessionToken: "newer-transient",
        brokerUserId: "broker-user",
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

    it("groups base and slot tokens consistently and decommissions duplicate scan-only rows before restart", () => {
      expect(getBaseBotSessionToken("base-token-slot4")).toBe("base-token");
      expect(getBaseBotSessionToken("base-token")).toBe("base-token");
      expect(restartSource).toContain("reconcileDuplicateBrokerSessions(runningSessions)");
      expect(restartSource).toContain('authorization.state !== "valid" || !authorization.brokerUserId');
      expect(restartSource).toContain("duplicate.hasOpenTrade");
      expect(restartSource).toContain('duplicate persisted session for the same Upstox account; canonical session selected');
      expect(restartSource.indexOf("reconcileDuplicateBrokerSessions(runningSessions)")).toBeLessThan(
        restartSource.indexOf("for (const session of reconciledSessions)"),
      );
    });
  });
});
