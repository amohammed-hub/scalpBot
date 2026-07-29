import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getIstDateKey,
  getOptionExpiryDateKey,
  getOptionTimeExitReason,
  isOptionExpiryTradable,
} from "./botEngine";
import { isOptionTrade } from "../shared/optionTradeIdentity";
import { getStoppedTradeQuoteState } from "./stoppedTradeQuoteState";

const here = dirname(fileURLToPath(import.meta.url));
const engineSource = readFileSync(join(here, "botEngine.ts"), "utf8");
const routerSource = readFileSync(join(here, "routers.ts"), "utf8");
const dashboardSource = readFileSync(join(here, "../client/src/pages/Dashboard.tsx"), "utf8");

function between(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("29 July option-trading incident regressions", () => {
  describe("expiry selection is authoritative in IST", () => {
    const incidentTime = new Date("2026-07-29T15:20:00.000Z"); // 20:50 IST

    it("computes the incident trading date in IST", () => {
      expect(getIstDateKey(incidentTime)).toBe("2026-07-29");
    });

    it("rejects the expired 28JUL26 contract on 29 July", () => {
      expect(isOptionExpiryTradable("2026-07-28", incidentTime)).toBe(false);
    });

    it("accepts same-day and future expiries but rejects absent/invalid dates", () => {
      expect(isOptionExpiryTradable("2026-07-29", incidentTime)).toBe(true);
      expect(isOptionExpiryTradable("2026-08-04", incidentTime)).toBe(true);
      expect(isOptionExpiryTradable(undefined, incidentTime)).toBe(false);
      expect(isOptionExpiryTradable("28JUL26", incidentTime)).toBe(false);
    });

    it("normalizes both millisecond and second expiry timestamps", () => {
      const expiryMs = Date.parse("2026-08-04T00:00:00.000Z");
      expect(getOptionExpiryDateKey(expiryMs)).toBe("2026-08-04");
      expect(getOptionExpiryDateKey(expiryMs / 1000)).toBe("2026-08-04");
      expect(isOptionExpiryTradable(expiryMs, incidentTime)).toBe(true);
      expect(isOptionExpiryTradable(expiryMs / 1000, incidentTime)).toBe(true);
    });

    it("derives exact Upstox expiry dates from contracts instead of aliases", () => {
      const nseResolver = between(
        engineSource,
        "export async function fetchUpcomingOptionExpiryKeys",
        "// ── Token Validation",
      );
      expect(nseResolver).toContain("/v2/option/contract?instrument_key=");
      expect(nseResolver).toContain("expiry_date=${expiry}");
      expect(nseResolver).toContain("getOptionExpiryDateKey(contract.expiry)");
      expect(nseResolver).not.toMatch(/const expiryOrder\s*=\s*isBankNifty/);
      expect(nseResolver).not.toMatch(/\[\s*"current_(?:week|month)"/);
    });

    it("uses the same unexpired exact-date policy for restart restoration and Hero Zero scans", () => {
      const restoreResolver = between(
        engineSource,
        "export async function resolveSpecificOptionToken",
        "// ── Shadow Mode API helpers",
      );
      expect(restoreResolver).toContain("fetchUpcomingOptionExpiryKeys");
      expect(restoreResolver).toContain("getOptionExpiryDateKey(row.expiry) === expiry");
      expect(restoreResolver).toContain("isOptionExpiryTradable(row.expiry)");

      expect(routerSource).toContain("fetchUpcomingOptionExpiryKeys(underlyingToken, accessToken, 4)");
      expect(routerSource).toContain("getOptionExpiryDateKey(row.expiry) === expiry");
      expect(routerSource).not.toMatch(/option\/chain\?[^\n]*expiry_date=(?:current|next)_(?:week|month)/);
    });
  });

  describe("Variant C has no option time exit", () => {
    it.each([
      [20 * 60_000, "OpeningBurst"],
      [9 * 60_000, "MCXEvening"],
      [24 * 60 * 60_000, undefined],
    ])("returns no elapsed-time exit for age %s and layer %s", (age, layer) => {
      expect(getOptionTimeExitReason(age, layer)).toBeNull();
    });

    it("keeps the tested policy adjacent to runtime exit evaluation", () => {
      expect(engineSource).toContain("getOptionTimeExitReason(tradeAgeMs, trade.signalLayer)");
      expect(engineSource).not.toMatch(/trade\.isIndexOptions[\s\S]{0,250}Time Exit \(20min/);
    });
  });

  describe("option entries and marks fail closed", () => {
    const mcxResolver = between(
      engineSource,
      "export async function resolveAtmMcxOptionToken",
      "export async function placeUpstoxOrder",
    );
    const entryGate = between(
      engineSource,
      "Every non-paper option must be verified",
      "OPTION EXECUTION QUALITY GATES",
    );
    const livePrices = between(
      routerSource,
      "livePrices: publicProcedure",
      "startSecondary: publicProcedure",
    );

    it("does not manufacture an MCX premium when authenticated quotes fail", () => {
      expect(mcxResolver).not.toMatch(/estimatedPremium/);
      expect(mcxResolver).not.toMatch(/underlyingPrice\s*\*\s*0\.0/);
    });

    it("blocks before sizing when contract validation or the final live quote fails", () => {
      expect(entryGate).toContain("validateOptionToken");
      expect(entryGate).toContain("fetchFullQuote");
      expect(entryGate).toContain("No order or demo trade was created");
      expect(entryGate.match(/return;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    it("never substitutes entry price for a missing live option mark", () => {
      expect(livePrices).not.toMatch(/optionPremiumPrice\s*:\s*[^\n]*entryPrice/);
      expect(livePrices).toContain('optionQuoteStatus = "unavailable"');
    });

    it("serializes a stopped persisted CRUDE option as unavailable even when the session flag is stale", () => {
      const state = getStoppedTradeQuoteState({
        isIndexOptions: false,
        symbol: "CRUDEOIL_PE_8150",
        symbolLabel: "CRUDEOIL 17AUG26 8150 PE",
      });

      expect(state).toEqual({
        isIndexOptions: true,
        optionPremiumPrice: null,
        optionQuoteStatus: "unavailable",
        optionQuoteUpdatedAt: null,
      });
    });

    it("recognizes bounded CE/PE contract tokens without misclassifying ordinary symbols", () => {
      expect(isOptionTrade({ symbolLabel: "GOLD 28JUL26 57300 CE" })).toBe(true);
      expect(isOptionTrade({ symbol: "NIFTY_PE_24800" })).toBe(true);
      expect(isOptionTrade({ symbol: "SENSEX" })).toBe(false);
      expect(isOptionTrade({ symbol: "RELIANCE" })).toBe(false);
    });

    it("wires the tested stopped-quote contract into the DB-only live-data response", () => {
      const stoppedStatus = between(
        routerSource,
        "const dbOpenTradeQuoteState",
        "const stateOpenTradeIsOption",
      );
      expect(stoppedStatus).toContain("getStoppedTradeQuoteState");
      expect(stoppedStatus).toContain("...dbOpenTradeQuoteState");
      expect(stoppedStatus).toContain("isIndexOptions: dbOpenTradeQuoteState.isIndexOptions");
    });

    it("renders unavailable option marks and P&L explicitly from durable trade identity", () => {
      expect(dashboardSource).toContain("P&L unavailable");
      expect(dashboardSource).toContain('optionQuoteStatus !== "unavailable"');
      expect(dashboardSource).toContain('"Unavailable"');
      expect(dashboardSource).toContain("const activeTradeIsOption = isOptionTrade");
      expect(dashboardSource).toContain("if (!activeTradeIsOption) return currentPrice");
      expect(dashboardSource).not.toContain("if (!isIndexOptions) return currentPrice");
    });
  });
});
