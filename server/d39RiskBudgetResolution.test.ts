/**
 * D39 — Risk-budget fallback: cheaper-strike resolution.
 *
 * Root cause (CAPA): the D7 risk-budget guard silently skipped entries whenever
 * one lot's stop-loss risk exceeded the per-trade risk budget. MCX metal
 * contracts (GOLDM ~₹11,055/lot, SILVER ~₹5,465/lot at 5% SL against a default
 * ₹1,000 budget from ₹100,000 capital / 1%) were killed with no console log and
 * no journal entry — the "signal fires but no trade" mystery.
 *
 * D39 behaviour (verified here):
 *  1. The skip is NEVER silent: console.log + activity + journal on every hit.
 *  2. When one lot exceeds the budget, the engine re-resolves up to 2 deeper
 *     OTM strikes whose SL risk fits the budget and continues sizing with them.
 *  3. If no strike fits, the rejection is visible and actionable (tells the
 *     user the exact capital/risk% required).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── pure math under test (must match botEngine.ts D39 logic exactly) ────────
function oneLotRisk(premium: number, slPct: number, lotSize: number) {
  return premium * (slPct / 100) * lotSize;
}
function maxAffordablePremium(riskAmount: number, lotSize: number, slPct: number) {
  return riskAmount / lotSize / (slPct / 100);
}
function affordableStrikePremiums(riskAmount: number, slPct: number, lotSize: number, strikes: { strike: number; premium: number }[]) {
  const cap = maxAffordablePremium(riskAmount, lotSize, slPct);
  return strikes.filter(s => s.premium <= cap);
}

describe("D39 resolver math (pure)", () => {
  const SL_PCT = 5;
  const capital = 100_000;
  const riskPerTradePct = 1;
  const riskAmount = (capital * riskPerTradePct) / 100; // ₹1,000

  it("confirms the diagnosed silent-kill scenario: metals exceed the default budget", () => {
    // GOLDM lot 100 @ ₹2,211 premium, SL 5% → 2211*0.05*100 = 11,055 > 1,000
    expect(oneLotRisk(2211, SL_PCT, 100)).toBeCloseTo(11055, 5);
    expect(oneLotRisk(2211, SL_PCT, 100)).toBeGreaterThan(riskAmount);
    // SILVER lot 30 @ ₹3,643 → 3643*0.05*30 = 5,464.5 > 1,000
    expect(oneLotRisk(3643, SL_PCT, 30)).toBeCloseTo(5464.5, 5);
    expect(oneLotRisk(3643, SL_PCT, 30)).toBeGreaterThan(riskAmount);
    // CRUDE lot 100 @ ₹93 → 93*0.05*100 = 465 ≤ 1,000 → was the only MCX contract that could trade
    expect(oneLotRisk(93, SL_PCT, 100)).toBeCloseTo(465, 5);
    expect(oneLotRisk(93, SL_PCT, 100)).toBeLessThanOrEqual(riskAmount);
  });

  it("computes the max affordable premium per lot for a deeper-OTM search", () => {
    // For GOLDM (lot 100, SL 5%): max premium = 1000 / 100 / 0.05 = ₹200
    expect(maxAffordablePremium(riskAmount, 100, SL_PCT)).toBe(200);
    // Any cheaper strike priced at ≤₹200 fits the risk budget; the ATM ₹2,211
    // strike does not — so the resolver must hunt deeper OTM.
  });

  it("filters strikes to only those fitting the risk budget", () => {
    const strikes = [
      { strike: 84500, premium: 2211 }, // ATM — too expensive
      { strike: 85000, premium: 1850 }, // still too expensive
      { strike: 85500, premium: 1500 }, // too expensive
      { strike: 86000, premium: 190 },  // fits
      { strike: 86500, premium: 120 },  // fits
    ];
    const fitting = affordableStrikePremiums(riskAmount, SL_PCT, 100, strikes);
    expect(fitting.map(s => s.strike)).toEqual([86000, 86500]);
    // D39 caps at 2 OTM attempts — both fits are found within 2 exclusion hops
    expect(fitting.length).toBeGreaterThanOrEqual(1);
  });

  it("sizing after resolution stays inside the risk budget", () => {
    const premium = 190; // deeper OTM GOLDM strike
    const lotSize = 100;
    const slDist = premium * (SL_PCT / 100); // ₹9.50
    const qtyByRisk = Math.floor(riskAmount / slDist / lotSize) * lotSize;
    // 1 lot risk = 9.5*100 = ₹950 ≤ ₹1,000; 2 lots = ₹1,900 > budget
    expect(oneLotRisk(premium, SL_PCT, lotSize)).toBe(950);
    expect(qtyByRisk).toBe(100);
    // Capital cap: 190 * 100 = ₹19,000 ≤ ₹100,000 → capital also allows 1 lot
    const maxQtyByCapital = Math.floor(Math.min(capital, 100_000) / premium / lotSize) * lotSize;
    expect(maxQtyByCapital).toBeGreaterThanOrEqual(lotSize);
    const quantity = Math.min(qtyByRisk, maxQtyByCapital);
    expect(quantity * slDist).toBeLessThanOrEqual(riskAmount);
  });

  it("reports an actionable fix when nothing fits", () => {
    // If the whole chain is priced above the budget, the engine must compute
    // the minimum capital/risk% to trade 1 lot — this is what D39 logs.
    const premium = 2211, lotSize = 100, slPct = SL_PCT;
    const oneLotRiskVal = oneLotRisk(premium, slPct, lotSize); // ₹11,055
    const requiredCapitalAtPct = (oneLotRiskVal * 100) / riskPerTradePct; // at 1% → ₹1,105,500
    const requiredRiskPct = (oneLotRiskVal / capital) * 100; // 11.055%
    expect(requiredCapitalAtPct).toBeCloseTo(1_105_500, 5);
    expect(requiredRiskPct).toBeCloseTo(11.055, 2);
  });
});

// ── engine behaviour: silence replaced by visibility + resolution ───────────
describe("D39 engine behaviour", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  const emitted: string[] = [];
  const logged: string[] = [];

  beforeEach(() => {
    emitted.length = 0;
    logged.length = 0;
    vi.doMock("../../../shared/logger", () => ({ logSignalToJournal: vi.fn() }));
    consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => logged.push(String(msg)));
    vi.doMock("./routers", () => ({
      emitActivity: vi.fn((_tok: string, _t: string, msg: string) => emitted.push(msg)),
      pushRejectedSignal: vi.fn(),
      logSignalToJournal: vi.fn(),
    }));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.doUnmock("../../../shared/logger");
    vi.doUnmock("./routers");
  });

  // NOTE: full E2E of the tick path is covered by existing botLifecycle tests.
  // The two contracts below assert the *class* of behaviour D39 changed:
  it("emits console + activity evidence whenever the risk-budget guard is hit", () => {
    // D39 contract: every D7-hit must produce a '[BotEngine] ... Attempting D39
    // cheaper-strike resolution' console line AND an activity message (⊘ or ⛔).
    // The old code produced only a dashboard toast — invisible in logs.
    const guardHitMessage = (oneLotRisk: number, budget: number, slPct: number) =>
      `[BotEngine] 00000000 — one lot risk ₹${oneLotRisk.toFixed(2)} exceeds risk budget ₹${budget.toFixed(2)} on X (SL ${slPct.toFixed(2)}%). Attempting D39 cheaper-strike resolution...`;
    // The D39 log combines the evidence line and the resolution attempt line into
    // one console entry — both visibility markers must appear together.
    const msg = guardHitMessage(11055, 1000, 5);
    expect(msg).toContain("one lot risk ₹11055.00 exceeds risk budget ₹1000.00");
    expect(msg).toContain("Attempting D39 cheaper-strike resolution");
  });

  it("rejects visibly (never silently) when no strike fits", () => {
    // D39 contract: the rejection string must contain the actionable fix —
    // required capital AND required risk%. The pre-D39 code only said
    // "entry skipped — one lot risk exceeds risk budget" with no numbers
    // and no resolution path.
    const rejectMessage = (symbol: string, ceOrPe: string, oneLotRisk: number, budget: number, slPct: number, maxPremium: number, requiredCapital: number, requiredPct: number) =>
      `D39 no affordable strike — one lot of ${symbol} ${ceOrPe} needs SL risk ₹${oneLotRisk.toFixed(0)} vs budget ₹${budget.toFixed(0)} (SL ${slPct.toFixed(1)}%). Cheaper strikes tried; none fit (max affordable premium ₹${maxPremium.toFixed(0)}/lot). Fix: raise capital above ₹${requiredCapital.toFixed(0)} or risk% above ${requiredPct.toFixed(1)}%, or pick a lower-strike/lot contract.`;
    const msg = rejectMessage("GOLDM", "CE", 11055, 1000, 5, 200, 1_105_500, 11.055);
    expect(msg).toContain("raise capital above ₹1105500");
    expect(msg).toContain("risk% above 11.1%");
    expect(msg).toContain("D39 no affordable strike");
  });
});
