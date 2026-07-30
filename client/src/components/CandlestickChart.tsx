import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, type IChartApi, type ISeriesApi, type IPriceLine, type CandlestickData, type Time } from "lightweight-charts";

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timestamp: number;
}

interface CandlestickChartProps {
  candles: Candle[];
  height?: number;
  entryPrice?: number;
  slPrice?: number;
  targetPrice?: number;
}

export default function CandlestickChart({ candles, height = 300, entryPrice, slPrice, targetPrice }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "rgba(255,255,255,0.5)",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.03)" },
        horzLines: { color: "rgba(255,255,255,0.03)" },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 2 },
        horzLine: { color: "rgba(255,255,255,0.2)", width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.1)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      priceLinesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  // Update candle data
  useEffect(() => {
    if (!seriesRef.current || !candles.length) return;

    const data: CandlestickData<Time>[] = candles.map((c) => ({
      time: (Math.floor(c.timestamp / 1000)) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const series = seriesRef.current;
    series.setData(data);

    // A selected bot can change without remounting the chart. Remove the previous
    // slot's trade overlays before drawing the authoritative levels for this slot.
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];

    if (entryPrice) {
      priceLinesRef.current.push(series.createPriceLine({
        price: entryPrice,
        color: "#60a5fa",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Entry",
      }));
    }
    if (slPrice) {
      priceLinesRef.current.push(series.createPriceLine({
        price: slPrice,
        color: "#ef4444",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "SL",
      }));
    }
    if (targetPrice) {
      priceLinesRef.current.push(series.createPriceLine({
        price: targetPrice,
        color: "#10b981",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "Target",
      }));
    }
  }, [candles, entryPrice, slPrice, targetPrice]);

  return (
    <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
  );
}
