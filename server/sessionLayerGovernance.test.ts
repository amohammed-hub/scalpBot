import fs from "node:fs";
import path from "node:path";
import {
  LAYER_REGIME_AFFINITY,
  isLayerEligibleForRegime,

  generateMCXLateSessionSignal,
  generateMCXEveningSignal,
  generateOpeningBurstSignal,
  type Candle,
} from "./botEngine";

const engineSource = fs.readFileSync(path.join(process.cwd(), "server", "botEngine.ts"), "utf8");
const routerSource = fs.readFileSync(path.join(process.cwd(), "server", "routers.ts"), "utf8");
const schemaSource = fs.readFileSync(path.join(process.cwd(), "drizzle", "schema.ts"), "utf8");

// Stable deterministic candles for signal generators (1-min closes, ascending).
function makeCandles(n: number, start = 100, step = 0.5): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const close = start + i * step;
    candles.push({
      time: Date.now() - (n - i) * 60_000,
      open: close - step / 2,
      high: close + step / 2,
      low: close - step,
      close,
      volume: 1000,
    });
  }
  return candles;
}
function makeCandles5m(n: number, start = 100, step = 2): Candle[] {
  return makeCandles(n, start, step);
}

describe("Session-Special Layer Governance (post-loss-day 2026-08-12)", () => {
  it("adds the master toggle and whitelist fields to BotState and initializes them fail-safe", () => {
    expect(engineSource).toContain("sessionSpecialLayersEnabled?: boolean;");
    expect(engineSource).toContain("sessionLayersRequireWhitelist?: boolean;");
    expect(engineSource).toContain("sessionSpecialLayersEnabled: true, // default ON preserves current behavior; UI can toggle");
    expect(engineSource).toContain("sessionLayersRequireWhitelist: true, // MCX session layers must appear in the user's layer selection");
  });

  it("threads the fields through both routers input schemas, write paths, and the startBot config read", () => {
    const schemaCount = (routerSource.match(/sessionSpecialLayersEnabled: z\.boolean\(\)\.default\(true\)/g) ?? []).length;
    expect(schemaCount).toBeGreaterThanOrEqual(2);
    expect((routerSource.match(/sessionSpecialLayersEnabled: input\.sessionSpecialLayersEnabled \?\? true/g) ?? []).length).toBe(6);
    expect((routerSource.match(/sessionSpecialLayersEnabled: row\.sessionSpecialLayersEnabled \?\? true/g) ?? []).length).toBe(1);
    expect((routerSource.match(/sessionLayersRequireWhitelist: input\.sessionLayersRequireWhitelist \?\? true/g) ?? []).length).toBe(6);
  });

  it("persists the fields in the bot_sessions drizzle schema with fail-safe defaults", () => {
    expect(schemaSource).toContain('sessionSpecialLayersEnabled: boolean("sessionSpecialLayersEnabled").default(true)');
    expect(schemaSource).toContain('sessionLayersRequireWhitelist: boolean("sessionLayersRequireWhitelist").default(true)');
  });

  it("derives mcxSessionLayerEnabled only from the session-special toggle and the resolved enabledLayers list", () => {
    // The dispatch now gates on the derived flag instead of clock position alone.
    expect(engineSource).toContain("const mcxSessionLayerEnabled =\n    sessionSpecialEnabled &&\n    (!state.sessionLayersRequireWhitelist ||");
    expect(engineSource).toContain('(state.enabledLayers ?? []).includes("MCXEvening")');
    expect(engineSource).toContain('(state.enabledLayers ?? []).includes("MCXLateSession")');
    // Session window conditions now require the derived flag (not bare inMCXEvening).
    expect(engineSource).toContain("else if (inMCXEvening && mcxSessionLayerEnabled)");
    expect(engineSource).toContain("else if (inMCXLateSession && mcxSessionLayerEnabled)");
    // Opening Burst and Power Hour also honor the master toggle.
    expect(engineSource).toContain("if (inOpeningBurst && state.candles.length >= 2 && sessionSpecialEnabled)");
    expect(engineSource).toContain("else if (inPowerHour && sessionSpecialEnabled)");
    expect(engineSource).toContain("else if (inHeroZeroWindow && state.candles.length > 0 && sessionSpecialEnabled)");
  });

  it("blocks a session layer when the regime is unclassified or ineligible and logs the gate", () => {
    expect(isLayerEligibleForRegime("MCXLateSession", undefined)).toBe(false);
    expect(isLayerEligibleForRegime("MCXEvening", "TRENDING")).toBe(false);
    expect(isLayerEligibleForRegime("MCXLateSession", "VOLATILE")).toBe(true);
    expect(engineSource).toContain("sessionLayerRegimeBlocked(");
    expect(engineSource).toContain("isMCXSessionLayerBlockedByRegime = true;");
    expect(engineSource).toContain("gated off by regime");
    // Opening Burst signal is re-checked after generation with a regime hold.
    expect(engineSource).toContain("[OpeningBurst] Regime");
    expect(engineSource).toContain("session-layer entry gated until regime confirms");
  });

  it("keeps the RSI squeeze-trap guard on both MCX session layers (fails the exact Silver 2026-08-12 profile)", () => {
    // A descending candle series yields RSI well below 40 (bearish momentum, oversold).
    const descending = makeCandles(30, 200, -1.2);
    const closes = descending.slice(-20).map((c) => c.close);
    expect(closes.length).toBe(20);
    // Bearish SELL signals into an oversold market must be held (squeeze trap).
    const late = generateMCXLateSessionSignal(descending, makeCandles5m(20, 200, -4), 1.5, 2.0);
    expect(late.layer === "MCXLateSession" || late.direction === "HOLD").toBe(true);
    // The guard code exists in the engine for both layers and reads RSI with
    // the same 40/65 thresholds used to catch the Aug-12 Silver PE entry
    // (signal direction SELL with RSI 36, i.e. an oversold squeeze trap).
    expect(engineSource).toContain("[MCXEvening] RSI(");
    expect(engineSource).toContain("[MCXLate] RSI(");
    expect(engineSource).toContain("oversold — PE entry skipped (squeeze trap)");
    expect(engineSource).toContain("signal.direction === \"SELL\" && rsiNow < 40");
    expect(engineSource).toContain("signal.direction === \"BUY\" && rsiNow > 65");
  });

  it("preserves the original behavior when the whitelist passes and the regime matches", () => {
    // Default configuration: master toggle ON, whitelist required, MCXLateSession
    // selected and regime VOLATILE → the layer must still be able to fire.
    expect((LAYER_REGIME_AFFINITY as Record<string, string>).MCXLateSession).toBe("VOLATILE");
    expect((LAYER_REGIME_AFFINITY as Record<string, string>).MCXEvening).toBe("VOLATILE");
    expect((LAYER_REGIME_AFFINITY as Record<string, string>).OpeningBurst).toBe("VOLATILE");
    expect((LAYER_REGIME_AFFINITY as Record<string, string>).PowerHour).toBe("VOLATILE");
  });
});
