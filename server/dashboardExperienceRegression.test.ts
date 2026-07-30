import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(join(here, "../client/src/pages/Dashboard.tsx"), "utf8");
const chartSource = readFileSync(join(here, "../client/src/components/CandlestickChart.tsx"), "utf8");
const backtestSource = readFileSync(join(here, "../client/src/pages/Backtest.tsx"), "utf8");

describe("30 July dashboard experience regressions", () => {
  describe("per-bot live chart", () => {
    it("polls and renders the explicitly selected bot slot rather than the primary config", () => {
      expect(dashboardSource).toContain("const [selectedChartSlot, setSelectedChartSlot] = useState(0);");
      expect(dashboardSource).toContain("const selectedChartSessionToken = selectedChartSlot === 0 ? sessionToken : `${sessionToken}-slot${selectedChartSlot}`;");
      expect(dashboardSource).toContain("const chartBot = (allBots ?? []).find((bot: any) => bot.slot === selectedChartSlot);");
      expect(dashboardSource).toContain('aria-label="Chart bot"');
      expect(dashboardSource).toContain("candles={chartCandles}");
      expect(dashboardSource).not.toContain("Live Price — {config.instrumentSymbol} (1m candles)");
    });

    it("removes prior trade overlays before drawing the selected slot's levels", () => {
      expect(chartSource).toContain("const priceLinesRef = useRef<IPriceLine[]>([]);");
      expect(chartSource).toContain("for (const line of priceLinesRef.current) series.removePriceLine(line);");
      expect(chartSource).toContain("priceLinesRef.current = [];");
    });
  });

  describe("complete index-option selection", () => {
    for (const symbol of ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX", "BANKEX", "MIDCPNIFTY"]) {
      it(`keeps ${symbol} in the authoritative automatic option catalog`, () => {
        expect(dashboardSource).toContain(`symbol: "${symbol}"`);
      });
    }

    it("generates both bot-card selectors from the authoritative catalog with explicit option grouping", () => {
      expect(dashboardSource.match(/Index Options — auto OTM CE\/PE/g)?.length).toBe(2);
      expect(dashboardSource.match(/INSTRUMENTS\.filter\(instrument => instrument\.segment\.includes\("Index Options"\)\)/g)?.length).toBe(2);
      expect(dashboardSource).toContain("isIndexOptions: true");
      expect(dashboardSource).toContain("underlyingToken: resolved.token");
    });
  });

  describe("mobile containment", () => {
    it("prevents root overflow and allows the main flex child to shrink", () => {
      expect(dashboardSource).toContain("flex flex-col md:flex-row overflow-x-hidden");
      expect(dashboardSource).toContain('className="flex-1 min-w-0 p-3 sm:p-4 md:p-6 pb-20 md:pb-6"');
    });

    it("lets critical controls and bottom navigation fit narrow screens", () => {
      expect(dashboardSource).toContain("w-full sm:w-auto px-3 sm:px-4 py-2");
      expect(dashboardSource).toContain("flex-1 min-w-0 flex flex-col items-center");
      expect(dashboardSource).not.toContain("min-w-[56px]");
    });
  });

  describe("backtester", () => {
    it("contains all supported index underlyings and labels option results honestly", () => {
      for (const token of [
        "NSE_INDEX|Nifty 50",
        "NSE_INDEX|Nifty Bank",
        "NSE_INDEX|Nifty Fin Service",
        "BSE_INDEX|SENSEX",
        "BSE_INDEX|BANKEX",
        "NSE_INDEX|NIFTY MID SELECT",
      ]) expect(backtestSource).toContain(token);
      expect(backtestSource).toContain("does not simulate option premiums, spreads, or fills");
      expect(backtestSource).toContain("signal-proxy results—not option-contract P&amp;L");
    });

    it("clears stale output, presents request errors, and does not show the empty state behind comparison results", () => {
      expect(backtestSource).toContain("setResult(null);");
      expect(backtestSource).toContain("setCompareResult(null);");
      expect(backtestSource).toContain("const backtestError = runMutation.error ?? compareMutation.error;");
      expect(backtestSource).toContain("!result && !compareResult && !isBacktestPending && !backtestError");
      expect(backtestSource).toContain("Backtest could not run");
    });

    it("keeps narrow-screen forms and tables usable", () => {
      expect(backtestSource).toContain("overflow-x-hidden");
      expect(backtestSource).toContain("grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3");
      expect(backtestSource).toContain('table className="min-w-[680px] w-full text-xs"');
    });
  });
});
