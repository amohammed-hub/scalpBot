import fs from "node:fs";
import path from "node:path";
import {
  LAYER_REGIME_AFFINITY,
  deriveRegimeEligibleLayers,
  isLayerEligibleForRegime,
  type Signal,
} from "./botEngine";

const engineSource = fs.readFileSync(path.join(process.cwd(), "server", "botEngine.ts"), "utf8");
const routerSource = fs.readFileSync(path.join(process.cwd(), "server", "routers.ts"), "utf8");

const entryLayers: Signal["layer"][] = [
  "Breakout", "Pattern", "Trend", "Momentum", "TrendMomentum", "MACD_BB",
  "PowerHour", "MCXEvening", "MCXLateSession", "HeroZero", "ORB",
  "VWAPReversion", "VWAPPullback", "InstFootprint", "HourlyClose",
  "BoomingBulls", "FailedBreakout", "OpeningBurst", "CPR", "RedBarTheory",
  "TrikalStrategy", "Adeeb", "OIFlow", "MaxPainGravity", "PremiumRenko",
  "BoxingStrategy", "MeanReversionV13", "None",
];

describe("D5 complete regime-affinity contract", () => {
  it("declares a specific V2 affinity for every signal layer", () => {
    expect(Object.keys(LAYER_REGIME_AFFINITY).sort()).toEqual([...entryLayers].sort());
    expect(LAYER_REGIME_AFFINITY.None).toBe("NONE");
    for (const layer of entryLayers.filter(layer => layer !== "None")) {
      expect(["TRENDING", "RANGING", "VOLATILE", "ANY"]).toContain(LAYER_REGIME_AFFINITY[layer]);
    }
  });

  it("uses declared trending/ranging/volatile policies and never permits a DEAD-market entry", () => {
    const configured = [
      "Trend", "TrikalStrategy", "VWAPReversion", "MeanReversionV13",
      "BoxingStrategy", "ORB", "OpeningBurst", "OIFlow",
    ];

    expect(deriveRegimeEligibleLayers(configured, [], "TRENDING").enabledLayers)
      .toEqual(["Trend", "TrikalStrategy"]);
    expect(deriveRegimeEligibleLayers(configured, [], "RANGING").enabledLayers)
      .toEqual(["VWAPReversion", "MeanReversionV13", "BoxingStrategy"]);
    expect(deriveRegimeEligibleLayers(configured, [], "VOLATILE").enabledLayers)
      .toEqual(["ORB", "OpeningBurst", "OIFlow"]);
    expect(deriveRegimeEligibleLayers(configured, [], "DEAD").enabledLayers).toEqual([]);
    expect(isLayerEligibleForRegime("Trend", "DEAD")).toBe(false);
    expect(isLayerEligibleForRegime("unknown-layer", "TRENDING")).toBe(false);
  });

  it("keeps manual disables immutable while allowing a regime-filtered configured layer to return", () => {
    const configured = ["Trend", "TrikalStrategy", "VWAPReversion", "MeanReversionV13"];
    const userDisabled = ["TrikalStrategy"];
    const originalConfigured = [...configured];
    const originalUserDisabled = [...userDisabled];

    const trending = deriveRegimeEligibleLayers(configured, userDisabled, "TRENDING");
    expect(trending.enabledLayers).toEqual(["Trend"]);
    expect(trending.userDisabledSkippedLayers).toEqual(["TrikalStrategy"]);
    expect(trending.regimeExcludedLayers).toEqual(["VWAPReversion", "MeanReversionV13"]);

    const ranging = deriveRegimeEligibleLayers(configured, userDisabled, "RANGING");
    expect(ranging.enabledLayers).toEqual(["VWAPReversion", "MeanReversionV13"]);
    expect(ranging.userDisabledSkippedLayers).toEqual(["TrikalStrategy"]);
    expect(configured).toEqual(originalConfigured);
    expect(userDisabled).toEqual(originalUserDisabled);
  });

  it("derives legacy ADX diagnostics from the single V2 snapshot and re-evaluates future-entry eligibility even with an open trade", () => {
    expect(engineSource).toContain("state.currentADX = tickRegimeSnapshot.adx;");
    expect(engineSource).toContain('state.currentRegime = state.regimeV2 === "TRENDING" ? "trending" : "choppy";');
    expect(engineSource).toContain("state.configuredLayers ??= [...(state.enabledLayers ?? [])];");
    expect(engineSource).toContain("deriveRegimeEligibleLayers(state.configuredLayers, Array.from(userBlocked), state.regimeV2);");
    expect(engineSource).toContain("this only changes future-entry");
    expect(engineSource).not.toContain("!state.openTrade\n    ) {\n      const regimeNow");
  });

  it("applies the same policy to special/direct signal paths and to manual configuration updates", () => {
    expect(engineSource).toContain("!isLayerEligibleForRegime(signal.layer, state.regimeV2)");
    expect(engineSource).toContain("D5 ${regimeLabel} affinity gate");
    expect(routerSource).toContain("const previousConfiguredLayers = bot.configuredLayers ?? bot.enabledLayers ?? [];");
    expect(routerSource).toContain("bot.configuredLayers = [...input.enabledLayers];");
    expect(routerSource).toContain("deriveRegimeEligibleLayers(");
  });
});
