import { Shield, AlertTriangle, TrendingDown, Target, ArrowRight } from "lucide-react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const rules = [
  {
    icon: Target,
    color: "oklch(0.78_0.18_195)",
    title: "The 1% Risk Rule",
    desc: "Never risk more than 1% of your total account capital on a single trade. This ensures that even a string of losses cannot wipe out your account, giving you the staying power to trade another day.",
    example: "Account: ₹1,00,000 → Max risk per trade: ₹1,000",
  },
  {
    icon: TrendingDown,
    color: "oklch(0.78_0.17_65)",
    title: "Hard Stop-Loss Orders",
    desc: "Every scalping trade must have a predefined stop-loss set before entry. A hard stop-loss automatically sells your position if the price drops to a certain level, capping your downside without emotional interference.",
    example: "Entry: ₹500 → SL at ₹495 (1% below entry)",
  },
  {
    icon: AlertTriangle,
    color: "oklch(0.78_0.17_65)",
    title: "Auto Trailing Stop-Loss",
    desc: "A trailing stop-loss moves upward as the price of the asset increases, locking in profits while still providing a safety net against sudden reversals. Platforms like OptionX automate this in real time.",
    example: "Price: ₹500 → Trail: ₹495 → Price: ₹510 → Trail: ₹505",
  },
  {
    icon: Shield,
    color: "oklch(0.78_0.18_195)",
    title: "GTT Orders (Good Till Triggered)",
    desc: "Upstox's GTT orders allow you to set both a target price and a stop-loss simultaneously. When one is triggered, the other is automatically cancelled — perfect for managing risk without constant monitoring.",
    example: "Entry: ₹500 | Target: ₹515 | SL: ₹492 (GTT pair)",
  },
];

const riskLevels = [
  { label: "Conservative", pct: 0.5, color: "oklch(0.78_0.18_195)" },
  { label: "Standard", pct: 1.0, color: "oklch(0.78_0.17_65)" },
  { label: "Aggressive", pct: 2.0, color: "oklch(0.65_0.22_25)" },
];

export default function RiskManagementSection() {
  const sectionRef = useScrollReveal();

  return (
    <section id="risk" className="py-24 relative">
      <div className="container" ref={sectionRef}>
        {/* Header */}
        <div className="grid lg:grid-cols-2 gap-16 items-start">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[oklch(0.78_0.17_65/0.3)] bg-[oklch(0.78_0.17_65/0.06)] mb-5">
              <span className="text-xs font-medium text-[oklch(0.78_0.17_65)] tracking-widest uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>
                04 — Risk Management
              </span>
            </div>
            <h2
              className="text-4xl md:text-5xl font-extrabold text-white mb-4 fade-up"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              Protect Your <span className="gradient-text">Capital</span> First
            </h2>
            <p className="text-white/55 text-base leading-relaxed mb-8 fade-up">
              Scalping involves high frequency and leverage, making strict risk management non-negotiable. Automation removes emotional decision-making — the single biggest cause of trading losses.
            </p>

            {/* Risk Level Visual */}
            <div className="glass-card rounded-2xl p-5 mb-8 fade-up">
              <h4 className="text-white/70 text-xs font-semibold uppercase tracking-widest mb-4" style={{ fontFamily: "'DM Mono', monospace" }}>
                Risk Per Trade (% of Capital)
              </h4>
              <div className="space-y-4">
                {riskLevels.map((r) => (
                  <div key={r.label}>
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-sm text-white/70">{r.label}</span>
                      <span className="text-sm font-bold" style={{ color: r.color, fontFamily: "'DM Mono', monospace" }}>
                        {r.pct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{
                          width: `${(r.pct / 2) * 100}%`,
                          background: r.color,
                          boxShadow: `0 0 8px ${r.color}`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-white/30 text-xs mt-4">
                Most professional scalpers target 0.5–1% risk per trade for long-term sustainability.
              </p>
            </div>

            <div className="glass-card rounded-2xl overflow-hidden fade-up">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663595065530/YS6FuJbAdBfZuGVr8MgfrP/risk-management-9Mfp48tksBrRGGTHrjNvMD.webp"
                alt="Risk Management Shield"
                className="w-full h-44 object-cover"
              />
            </div>
          </div>

          {/* Rules */}
          <div className="space-y-5">
            {rules.map((r, i) => (
              <div
                key={r.title}
                className="glass-card teal-glow-hover rounded-2xl p-5 fade-up"
                style={{ transitionDelay: `${i * 0.1}s` }}
              >
                <div className="flex gap-4">
                  <div
                    className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{
                      background: `oklch(from ${r.color} l c h / 0.1)`,
                      border: `1px solid oklch(from ${r.color} l c h / 0.25)`,
                    }}
                  >
                    <r.icon className="w-5 h-5" style={{ color: r.color }} />
                  </div>
                  <div>
                    <h4 className="text-white font-bold text-sm mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
                      {r.title}
                    </h4>
                    <p className="text-white/50 text-sm leading-relaxed mb-3">{r.desc}</p>
                    <div className="px-3 py-2 rounded-lg bg-white/4 border border-white/6">
                      <span className="text-xs text-white/35 font-mono">{r.example}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <a
              href="https://upstox.com/help-center/t-253652/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-[oklch(0.78_0.17_65/0.3)] text-[oklch(0.78_0.17_65)] font-semibold text-sm hover:bg-[oklch(0.78_0.17_65/0.08)] transition-colors duration-200 fade-up"
            >
              Learn About GTT Orders
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
