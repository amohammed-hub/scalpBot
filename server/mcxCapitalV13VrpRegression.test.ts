import fs from "node:fs";
import path from "node:path";
import { getRecommendedLayers } from "../shared/backtestLayerMap";
import {
  evaluateStrategyGate,
} from "./vrpRegimeFilter";

const engineSource = fs.readFileSync(path.join(process.cwd(), "server", "botEngine.ts"), "utf8");
const routerSource = fs.readFileSync(path.join(process.cwd(), "server", "routers.ts"), "utf8");

describe("Fix 2 — MCX capital guard (post-loss-day)", () => {
  it("clamps state.capital to 50k for MCX instruments at session start with an activity warning", () => {
    expect(engineSource).toContain("const MAX_MCX_CAPITAL_INR = 50000;");
    expect(engineSource).toContain("const isMcxInstrument = config.instrumentToken.startsWith(\"MCX\");");
    expect(engineSource).toContain("if (isMcxInstrument && state.capital > MAX_MCX_CAPITAL_INR)");
    expect(engineSource).toContain("state.capital = MAX_MCX_CAPITAL_INR;");
    expect(engineSource).toContain("MCX capital guard: configured");
  });
});

describe("Fix 3a — VRP/OI gate skips stale OI outside market hours", () => {
  it("injects the stale-OI exemption before evaluateStrategyGate", () => {
    expect(engineSource).toContain("const nseMarketCloseMin = 15 * 60 + 30; // 15:30 IST");
    expect(engineSource).toContain("const mcxNightOpenMin = 21 * 60;        // 21:00 IST (MCX evening session)");
    expect(engineSource).toContain("const oiDataStale =");
    expect(engineSource).toContain("const analyticsForGate = oiDataStale ? null : analytics;");
    expect(engineSource).toContain("OI data stale (market closed");
    expect(engineSource).toContain("analyticsForGate,           // option chain analytics (null when OI is stale)");
  });

  it("allows signals after NSE close when analytics=null (fail-open gate)", () => {
    // No analytics → no OI veto, no VRP (VRP also skipped without analytics).
    const result = evaluateStrategyGate(
      [], // daily candles
      null, // stale analytics forced to null
      "BUY",
      100,
      false,
      16 * 60 + 30, // 16:30 IST (after NSE close)
      false,
    );
    expect(result.allowed).toBe(true);
  });

  it("still applies the OI veto during market hours when analytics disagree", () => {
    const fakeAnalytics: any = {
      atmIv: 20,
      atmStrikeOi: {
        ceOiTotal: 5_000_000,
        peOiTotal: 1_000_000,
        ceOiChange: 500_000,
        peOiChange: 100_000,
        pcrOi: 0.2,
      },
      strikes: [{ strike: 100, ceOi: 5_000_000, peOi: 1_000_000, ceOiChange: 500_000, peOiChange: 100_000 }],
      spotPrice: 100,
      maxPain: 100,
      expiry: "2099-01-01",
    };
    const result = evaluateStrategyGate([], fakeAnalytics, "BUY", 100, false, 10 * 60 + 30, false);
    // Strong CE OI addition vs PE = bullish wall above → OI divergence against BUY may penalize;
    // verify the gate still runs (allowed only if no hard veto triggers).
    expect(result.reason).not.toBe("All gates passed — no adjustment");
  });
});

describe("Fix 3b — empty layer selection falls back to backtest-driven preset (includes V13)", () => {
  it("routers writes the recommended preset when enabledLayers is empty", () => {
    const matches = routerSource.match(/enabledLayers: JSON\.stringify\(\(input\.enabledLayers \?\? \[\]\)\.length \? input\.enabledLayers : getRecommendedLayers\(input\.instrumentLabel\)\)/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("recommends MeanReversionV13 for index instruments", () => {
    const nifty = getRecommendedLayers("Nifty 50");
    expect(nifty).toContain("MeanReversionV13");
    const bank = getRecommendedLayers("Nifty Bank");
    expect(bank).toContain("MeanReversionV13");
    const silver = getRecommendedLayers("MCX_SILVER");
    expect(silver).toContain("MeanReversionV13");
  });
});
