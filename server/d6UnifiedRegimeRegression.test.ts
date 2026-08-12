import fs from "node:fs";
import path from "node:path";
import {
  classifyMarketRegime,
  detectRegimeV2,
  generateSignalV2,
  type Candle,
} from "./botEngine";

const engineSource = fs.readFileSync(path.join(process.cwd(), "server", "botEngine.ts"), "utf8");
const routerSource = fs.readFileSync(path.join(process.cwd(), "server", "routers.ts"), "utf8");
const riskSource = fs.readFileSync(path.join(process.cwd(), "server", "riskManager.ts"), "utf8");
const dashboardSource = fs.readFileSync(path.join(process.cwd(), "client", "src", "pages", "Dashboard.tsx"), "utf8");

function makeInSessionCandles(): Candle[] {
  const lastTimestamp = Date.UTC(2026, 0, 5, 4, 30); // 10:00 IST
  return Array.from({ length: 40 }, (_, index) => {
    const close = 100 + index * 0.18;
    return {
      open: close - 0.08,
      high: close + 0.35,
      low: close - 0.35,
      close,
      volume: 1_000 + index * 10,
      timestamp: lastTimestamp - (39 - index) * 60_000,
    };
  });
}

describe("D6 unified regime classification contract", () => {
  it("calculates the V2 regime once per fresh-candle tick, stores it on BotState, and passes that snapshot to V2 generation", () => {
    expect(engineSource).toContain("const tickRegimeSnapshot = detectRegimeV2(state.candles);");
    expect(engineSource).toContain("state.regimeV2 = tickRegimeSnapshot.regime;");
    expect(engineSource).toContain("tickRegimeSnapshot,");
    expect(engineSource).toContain("const regime = regimeSnapshot ?? detectRegimeV2(candles);");
  });

  it("carries the supplied V2 snapshot through a generated in-session signal", () => {
    const candles = makeInSessionCandles();
    const snapshot = detectRegimeV2(candles);
    const signal = generateSignalV2(candles, 1.5, 3, 0.55, [], 0, 0, 0, 0, null, undefined, snapshot);

    expect(["TRENDING", "RANGING", "VOLATILE", "DEAD"]).toContain(snapshot.regime);
    expect(signal.regimeV2).toBe(snapshot.regime);
  });

  it("uses the authoritative V2 value in every signal-journal outcome instead of the legacy display label", () => {
    expect(engineSource).toContain("signal.regimeV2 ??= state.regimeV2;");
    expect(engineSource).toContain("regime: signal.regimeV2 ?? state.regimeV2 ?? signal.marketRegime");
    expect(engineSource).not.toContain("regime: signal.marketRegime,");
  });

  it("surfaces the identical V2 value to both live-data and multi-bot dashboard views", () => {
    expect(routerSource).toContain("regimeV2: state.regimeV2 ?? null");
    expect(routerSource).toContain("regimeV2: inMem?.regimeV2 ?? null");
    expect(dashboardSource).toContain("const regimeV2 = (liveData as any)?.regimeV2");
    expect(dashboardSource).toContain("{regimeV2} (ADX");
  });

  it("makes the risk gate consume the stored V2 regime while retaining the legacy classifier only for V1 compatibility", () => {
    expect(riskSource).toContain("regimeV2?: RegimeV2");
    expect(riskSource).toContain("const regime = regimeV2 ?? \"UNKNOWN\";");
    expect(riskSource).not.toContain("classifyMarketRegime");

    const legacy = classifyMarketRegime(makeInSessionCandles());
    expect(legacy.regime).toBeDefined();
    expect(engineSource).toContain("@deprecated D6 keeps this only for the legacy V1 signal path");
  });
});
