import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { generateSignal, generateSignalV2, type Candle } from "./botEngine";

const here = dirname(fileURLToPath(import.meta.url));
const engineSource = readFileSync(join(here, "botEngine.ts"), "utf8");
const restartSource = readFileSync(join(here, "botRestart.ts"), "utf8");

function has(source: string, pattern: string | RegExp): boolean {
  return typeof pattern === "string" ? source.includes(pattern) : pattern.test(source);
}

function strongUptrendCandles(count: number, minutesPerCandle = 1): Candle[] {
  const start = Date.parse("2026-07-27T04:00:00.000Z"); // 09:30 IST
  let price = 23_800;
  return Array.from({ length: count }, (_, index) => {
    const open = price;
    price += minutesPerCandle === 1 ? 4 : 20;
    return {
      open,
      high: price + 3,
      low: open - 2,
      close: price,
      volume: 200_000 + index * 1_000,
      timestamp: start + index * minutesPerCandle * 60_000,
    };
  });
}

function callV1WithExplicitLayers(layers: string[]) {
  return generateSignal(
    strongUptrendCandles(90, 1), 1.5, 2, 0.55,
    strongUptrendCandles(24, 5), 0, 0, 0, false, layers,
  );
}

function callV2WithExplicitLayers(layers: string[]) {
  return generateSignalV2(
    strongUptrendCandles(90, 1), 1.5, 2, 0.55,
    strongUptrendCandles(24, 5), 0, 0, 0, 0, null, layers,
  );
}

describe("forensic safety contracts — 27 July incident", () => {
  describe("strategy selection fails closed", () => {
    it("V1 emits HOLD when the persisted layer list is explicitly empty", () => {
      const signal = callV1WithExplicitLayers([]);
      expect(signal.direction).toBe("HOLD");
      expect(signal.layer).toBe("None");
    });

    it("V2 emits HOLD when the persisted layer list is explicitly empty", () => {
      const signal = callV2WithExplicitLayers([]);
      expect(signal.direction).toBe("HOLD");
      expect(signal.layer).toBe("None");
    });

    it("V1 does not treat an empty layer list as permission to run every layer", () => {
      expect(has(engineSource, /_v1LayerOk\s*=\s*\([^)]*\)\s*=>\s*enabledLayers\.length\s*===\s*0\s*\|\|/)).toBe(false);
    });

    it("V2 does not treat an empty layer list as permission to run every layer", () => {
      expect(has(engineSource, /_layerOk\s*=\s*\([^)]*\)\s*=>\s*enabledLayers\.length\s*===\s*0\s*\|\|/)).toBe(false);
    });
  });

  describe("restart restores authoritative strategy and risk configuration", () => {
    const requiredMappings = [
      { name: "slStrategy", pattern: /slStrategy\s*:\s*\(?session\.slStrategy/ },
      { name: "useV2Engine", pattern: /useV2Engine\s*:\s*session\.useV2Engine/ },
      { name: "adaptiveRegimeEnabled", pattern: /adaptiveRegimeEnabled\s*:\s*session\.adaptiveRegimeEnabled/ },
      { name: "crudeOilCorrelation", pattern: /crudeOilCorrelation\s*:\s*session\.crudeOilCorrelation/ },
    ];

    for (const mapping of requiredMappings) {
      it(`restores ${mapping.name} from the persisted session`, () => {
        expect(has(restartSource, mapping.pattern)).toBe(true);
      });
    }

    it("does not erase per-layer trade counters on every deployment restart", () => {
      expect(has(restartSource, /layerTradesCount\s*:\s*\{\s*\}/)).toBe(false);
      expect(has(restartSource, /layerTradesCount\s*:\s*(session\.|restored|actual|recomputed)/)).toBe(true);
    });

    it("validates persisted enabledLayers and fails closed for missing, malformed, or explicit-empty state", () => {
      expect(has(restartSource, /Array\.isArray\s*\(/)).toBe(true);
      expect(has(restartSource, /enabledLayers[\s\S]{0,500}catch\s*\{\s*return\s*\[\]\s*;?\s*\}/)).toBe(true);
      expect(has(restartSource, /enabledLayers[\s\S]{0,500}:\s*\[\]/)).toBe(true);
      expect(has(restartSource, /enabledLayers[^\r\n]*getRecommendedLayers/)).toBe(false);
    });
  });

  describe("loss and trade limits are hard barriers", () => {
    it("does not let unlimitedTrades bypass the configured max-trade limit", () => {
      expect(has(engineSource, /tradesCount\s*>=\s*state\.maxTradesPerDay[^\n]*!state\.unlimitedTrades/)).toBe(false);
    });

    it("does not continue trading after the daily-loss limit in unlimited/admin mode", () => {
      expect(has(engineSource, /dailyPnl\s*<=\s*maxDailyLoss[\s\S]{0,500}if\s*\(state\.unlimitedTrades\)/)).toBe(false);
    });

    it("does not let unlimited/admin mode bypass StoplossGuard", () => {
      expect(has(engineSource, /slGuard\.isPaused[^\n]*!state\.unlimitedTrades/)).toBe(false);
    });

    it("does not let unlimited/admin mode bypass portfolio drawdown", () => {
      expect(has(engineSource, /ddCheck\.halted[^\n]*!state\.unlimitedTrades/)).toBe(false);
    });
  });

  describe("Renko exit is a controlled feature, not unreachable dead code", () => {
    it("declares an explicit renkoExitEnabled runtime flag", () => {
      expect(has(engineSource, /renkoExitEnabled\??\s*:\s*boolean/)).toBe(true);
    });

    it("does not disable production exit logic with a literal `false &&` guard", () => {
      expect(has(engineSource, /if\s*\(\s*false\s*&&\s*state\.candles/)).toBe(false);
    });
  });
});
