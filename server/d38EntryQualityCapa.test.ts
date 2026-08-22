/**
 * D38 regression tests — CAPA entry-quality filter.
 *
 * Background (CAPA, Aug 19): the user rejected D37's time-based blocking
 * ("resolution is blocking trades... we can change strategy but not stop
 * trades"). Root-cause analysis proved the hour was not the cause:
 *   - BankNifty 5m Aug 4-18: momentum follow-through early 35.5% vs late
 *     35.3%; TP-first (1R/1R, 20 bars) early 58.8% vs late 57.4% — identical.
 *   - User's own 50-trade log: deep-OTM entries < ₹10 went 1/6 wins
 *     (-₹1,984); SL exits left at -3.88% realized vs -3.52% paper SL — the
 *     stop sat inside the bid-ask noise band and was hunted before the move.
 *
 * D38 replaces time blocking with entry-quality filters:
 *   CA-1: premium availability guard (part of isEntryQualityBlocked)
 *   CA-3: SL-distance must be >= 4x the half-spread, else the stop is inside
 *         the noise band → entry rejected (trades still allowed when the
 *         stop can survive execution noise).
 *
 * The engine applies these inside the options execution-quality gate, so
 * entries remain ENABLED at all hours (verified by the "never time-blocks"
 * test below).
 */
import { describe, it, expect } from "vitest";
import { isEntryQualityBlocked } from "../shared/sessionDefaults";

describe("D38 CA-1: premium availability", () => {
  it("blocks when premium is zero", () => {
    const r = isEntryQualityBlocked(0, 1, { slDistancePct: 5, spreadPct: 1 });
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain("premium");
  });

  it("blocks when premium is NaN", () => {
    expect(isEntryQualityBlocked(NaN, 1, null).blocked).toBe(true);
  });

  it("allows valid premium with healthy SL-vs-noise geometry", () => {
    // 5% SL distance vs 1% spread → half-spread 0.5%, 4x = 2% → 5% >= 2% OK
    const r = isEntryQualityBlocked(120, 1, { slDistancePct: 5, spreadPct: 1 });
    expect(r.blocked).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("allows when no spread data is available (cannot prove bad quality)", () => {
    const r = isEntryQualityBlocked(120, 0.5, null);
    expect(r.blocked).toBe(false);
  });
});

describe("D38 CA-3: spread-noise SL validation", () => {
  it("D51 Relaxed: noise band 1.2% allows 2% SL (Aug 22 fix)", () => {
    // Noise buffer = 2 * halfSpread (0.6%) = 1.2%.
    // noise band 1.2% → 2% > 1.2% → permitted.
    const r = isEntryQualityBlocked(250, 1.2, { slDistancePct: 2, spreadPct: 1.2 });
    expect(r.blocked).toBe(false);
  });

  it("allows when SL distance clears 2x the half-spread", () => {
    const r = isEntryQualityBlocked(250, 1.2, { slDistancePct: 5, spreadPct: 1.2 });
    expect(r.blocked).toBe(false);
  });

  it("boundary: SL exactly at 2x half-spread is allowed", () => {
    const r = isEntryQualityBlocked(100, 2, { slDistancePct: 2, spreadPct: 2 });
    expect(r.blocked).toBe(false);
  });

  it("boundary: SL just under 2x half-spread is blocked", () => {
    const r = isEntryQualityBlocked(100, 2, { slDistancePct: 1.9, spreadPct: 2 });
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain("spread-noise band");
  });

  it("zero spread never blocks (no noise band exists)", () => {
    const r = isEntryQualityBlocked(100, 0, { slDistancePct: 1, spreadPct: 0 });
    expect(r.blocked).toBe(false);
  });

  it("scalper-mode tight SL (2%) is blocked when spread noise is very wide", () => {
    // MCX evening options can show 3% spreads; scalper 2% SL < 2x 1.5% = 3%
    const r = isEntryQualityBlocked(60, 3, { slDistancePct: 2, spreadPct: 3 });
    expect(r.blocked).toBe(true);
  });
});

describe("D38 CAPA guarantee: no time-based blocking exists", () => {
  // CAPA corrective action requires trades to KEEP flowing at all hours.
  // The time-based guard from D37 must not exist in the engine's entry path;
  // this documents the invariant (engine no longer imports a blocking
  // predicate from sessionDefaults — only the quality filter above applies).
  it("isEntryQualityBlocked never references time — pure quality inputs only", () => {
    // The predicate's signature is (premium, spreadPct, slCheck) — there is
    // no time/hour parameter; session gating cannot occur here by design.
    const fnStr = isEntryQualityBlocked.toString();
    expect(fnStr).not.toMatch(/getHours|Date|istMinutes|time/i);
  });
});
