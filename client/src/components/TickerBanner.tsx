import { TrendingUp, TrendingDown } from "lucide-react";

const tickerData = [
  { symbol: "NIFTY 50", price: "24,834.85", change: "+0.42%", up: true },
  { symbol: "BANKNIFTY", price: "53,218.60", change: "+0.68%", up: true },
  { symbol: "SENSEX", price: "81,632.10", change: "+0.35%", up: true },
  { symbol: "NIFTY IT", price: "38,450.25", change: "-0.21%", up: false },
  { symbol: "NIFTY FIN", price: "21,890.40", change: "+0.55%", up: true },
  { symbol: "MIDCAP 100", price: "55,120.75", change: "+0.18%", up: true },
  { symbol: "NIFTY AUTO", price: "22,340.90", change: "-0.14%", up: false },
  { symbol: "NIFTY PHARMA", price: "19,780.30", change: "+0.72%", up: true },
];

export default function TickerBanner() {
  // Duplicate for seamless loop
  const items = [...tickerData, ...tickerData];

  return (
    <div className="w-full overflow-hidden bg-[oklch(0.14_0.025_240)] border-b border-white/5 py-2">
      <div className="ticker-track">
        {items.map((item, i) => (
          <div key={i} className="ticker-item">
            <span className="text-white/40 font-medium">{item.symbol}</span>
            <span className="text-white/80 font-mono">{item.price}</span>
            <span
              className={`flex items-center gap-0.5 font-mono font-medium ${
                item.up ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.65_0.22_25)]"
              }`}
            >
              {item.up ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {item.change}
            </span>
            <span className="text-white/15 mx-2">|</span>
          </div>
        ))}
      </div>
    </div>
  );
}
