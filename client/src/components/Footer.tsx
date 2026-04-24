import { Zap, ExternalLink } from "lucide-react";

const links = [
  {
    title: "Upstox Tools",
    items: [
      { label: "Scalper Terminal", href: "https://upstox.com/scalper/" },
      { label: "Algoverse", href: "https://upstox.com/algoverse/" },
      { label: "Trading API", href: "https://upstox.com/trading-api/" },
      { label: "API Documentation", href: "https://upstox.com/developer/api-documentation/open-api/" },
    ],
  },
  {
    title: "Third-Party Platforms",
    items: [
      { label: "OptionX", href: "https://optionx.trade" },
      { label: "TradingView", href: "https://tradingview.com" },
      { label: "Sensibull", href: "https://sensibull.com" },
      { label: "Streak", href: "https://streak.tech" },
    ],
  },
  {
    title: "Learn & Comply",
    items: [
      { label: "Scalping Course (Upstox)", href: "https://upstox.com/uplearn/crash-courses/scalping-crash-course-b4/" },
      { label: "SEBI Algo Rules", href: "https://algobulls.com/blog/industry-insights-and-updates/sebi-new-algotrading-regulations-for-retail-investors-2026" },
      { label: "GTT Orders Guide", href: "https://upstox.com/help-center/t-253652/" },
      { label: "Upstox Community", href: "https://community.upstox.com" },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-white/5 pt-16 pb-8">
      <div className="container">
        <div className="grid md:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[oklch(0.78_0.18_195/0.15)] border border-[oklch(0.78_0.18_195/0.4)] flex items-center justify-center">
                <Zap className="w-4 h-4 text-[oklch(0.78_0.18_195)]" />
              </div>
              <span className="font-bold text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
                <span className="text-[oklch(0.78_0.18_195)]">Upstox</span>
                <span className="text-white/80"> Scalping Hub</span>
              </span>
            </div>
            <p className="text-white/35 text-xs leading-relaxed">
              A comprehensive resource for Indian retail traders looking to master scalping and algorithmic trading with Upstox.
            </p>
          </div>

          {/* Links */}
          {links.map((col) => (
            <div key={col.title}>
              <h4 className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-4" style={{ fontFamily: "'DM Mono', monospace" }}>
                {col.title}
              </h4>
              <ul className="space-y-2.5">
                {col.items.map((item) => (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-white/40 hover:text-[oklch(0.78_0.18_195)] text-xs transition-colors duration-200"
                    >
                      {item.label}
                      <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="section-divider mb-6" />

        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-white/20 text-xs">
            This is an educational resource. Not financial advice. Trading involves risk.
          </p>
          <p className="text-white/20 text-xs">
            Data sourced from Upstox, SEBI, OptionX, and AlgoBulls. © 2026 Upstox Scalping Hub.
          </p>
        </div>
      </div>
    </footer>
  );
}
