import { ExternalLink, Zap, BarChart2, TrendingUp, Code2 } from "lucide-react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const platforms = [
  {
    name: "OptionX",
    icon: Zap,
    tagline: "Built for Options Scalpers",
    color: "oklch(0.78_0.18_195)",
    features: ["One-Click Trading", "Auto SL Trailing", "MTM-Based Exits", "<5ms Latency", "OCO Orders", "16+ Broker Support"],
    method: "Direct Integration",
    link: "https://optionx.trade",
    highlight: true,
  },
  {
    name: "TradingView",
    icon: BarChart2,
    tagline: "Advanced Charting + Webhooks",
    color: "oklch(0.78_0.17_65)",
    features: ["Advanced Charting", "Custom Indicators", "Webhook Automation", "Pine Script Alerts", "Multi-timeframe", "Strategy Backtesting"],
    method: "Webhook / API Bridge",
    link: "https://tradingview.com",
    highlight: false,
  },
  {
    name: "Sensibull",
    icon: TrendingUp,
    tagline: "India's Options Platform",
    color: "oklch(0.78_0.18_195)",
    features: ["Options Strategy Builder", "Greeks Analysis", "IV Charts", "Payoff Diagrams", "Broker Integration", "Real-time Data"],
    method: "Direct Integration",
    link: "https://sensibull.com",
    highlight: false,
  },
  {
    name: "Streak",
    icon: Code2,
    tagline: "No-Code Algo Builder",
    color: "oklch(0.78_0.17_65)",
    features: ["No-Code Strategy", "Backtesting Engine", "Live Deployment", "Scanner Tools", "Multi-broker", "Cloud-Based"],
    method: "Direct Integration",
    link: "https://streak.tech",
    highlight: false,
  },
];

const apiHighlights = [
  { label: "Order Execution", value: "<45ms", sub: "Dedicated endpoint" },
  { label: "Rate Limit", value: "50 req/s", sub: "Order placements" },
  { label: "API Cost", value: "₹0", sub: "Completely free" },
  { label: "Uptime SLA", value: "99.9%", sub: "Guaranteed" },
];

export default function IntegrationsSection() {
  const sectionRef = useScrollReveal();

  return (
    <section id="integrations" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[oklch(0.78_0.18_195/0.02)] to-transparent pointer-events-none" />

      <div className="container" ref={sectionRef}>
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[oklch(0.78_0.17_65/0.3)] bg-[oklch(0.78_0.17_65/0.06)] mb-5">
            <span className="text-xs font-medium text-[oklch(0.78_0.17_65)] tracking-widest uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>
              03 — Third-Party Apps
            </span>
          </div>
          <h2
            className="text-4xl md:text-5xl font-extrabold text-white mb-4 fade-up"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            Powerful <span className="gradient-text">Integrations</span>
          </h2>
          <p className="text-white/55 text-base max-w-2xl mx-auto leading-relaxed fade-up">
            Connect Upstox to specialized platforms via the free Trading API to unlock advanced charting, one-click execution, and automated strategy deployment.
          </p>
        </div>

        {/* API Stats Bar */}
        <div className="glass-card rounded-2xl p-6 mb-12 grid grid-cols-2 lg:grid-cols-4 gap-6 fade-up">
          {apiHighlights.map((h) => (
            <div key={h.label} className="text-center">
              <div className="text-2xl font-black text-[oklch(0.78_0.18_195)] mb-1" style={{ fontFamily: "'DM Mono', monospace" }}>
                {h.value}
              </div>
              <div className="text-white/80 text-sm font-semibold">{h.label}</div>
              <div className="text-white/35 text-xs">{h.sub}</div>
            </div>
          ))}
        </div>

        {/* Platform Cards */}
        <div className="grid md:grid-cols-2 gap-5 mb-12">
          {platforms.map((p, i) => (
            <div
              key={p.name}
              className={`glass-card teal-glow-hover rounded-2xl p-6 fade-up relative overflow-hidden ${
                p.highlight ? "border border-[oklch(0.78_0.18_195/0.3)]" : ""
              }`}
              style={{ transitionDelay: `${i * 0.1}s` }}
            >
              {p.highlight && (
                <div className="absolute top-4 right-4 px-2 py-0.5 rounded-full bg-[oklch(0.78_0.18_195/0.15)] border border-[oklch(0.78_0.18_195/0.3)]">
                  <span className="text-xs font-bold text-[oklch(0.78_0.18_195)]" style={{ fontFamily: "'DM Mono', monospace" }}>
                    RECOMMENDED
                  </span>
                </div>
              )}
              <div className="flex items-start gap-4 mb-5">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: `oklch(from ${p.color} l c h / 0.12)`, border: `1px solid oklch(from ${p.color} l c h / 0.25)` }}
                >
                  <p.icon className="w-5 h-5" style={{ color: `${p.color}` }} />
                </div>
                <div>
                  <h3 className="text-white font-bold text-lg" style={{ fontFamily: "'Syne', sans-serif" }}>
                    {p.name}
                  </h3>
                  <p className="text-white/45 text-xs">{p.tagline}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-5">
                {p.features.map((f) => (
                  <div key={f} className="flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className="text-white/60 text-xs">{f}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-white/30 font-mono">{p.method}</span>
                <a
                  href={p.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold transition-colors duration-200"
                  style={{ color: p.color }}
                >
                  Visit Platform
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>

        {/* API CTA */}
        <div className="glass-card rounded-2xl p-8 text-center fade-up border border-[oklch(0.78_0.18_195/0.15)]">
          <h3 className="text-2xl font-bold text-white mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
            Build Your Own Integration
          </h3>
          <p className="text-white/50 text-sm mb-6 max-w-lg mx-auto">
            The Upstox Trading API is free, well-documented, and supports REST + WebSocket. Available in Python, Java, Node.js, and more.
          </p>
          <a
            href="https://upstox.com/trading-api/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] font-bold text-sm hover:bg-[oklch(0.82_0.18_195)] transition-colors duration-200"
          >
            <Code2 className="w-4 h-4" />
            View API Documentation
          </a>
        </div>
      </div>
    </section>
  );
}
