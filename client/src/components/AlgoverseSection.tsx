import { Bot, FlaskConical, Rocket, BarChart3, ArrowRight, CheckCircle2 } from "lucide-react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const steps = [
  { icon: Bot, step: "01", title: "Create Strategy", desc: "Build your algo using 80+ indicators — no coding required." },
  { icon: FlaskConical, step: "02", title: "Backtest & Validate", desc: "Test against historical data with clear return and drawdown metrics." },
  { icon: Rocket, step: "03", title: "Deploy to Live Market", desc: "Launch your strategy with a single click directly from your Upstox account." },
  { icon: BarChart3, step: "04", title: "Monitor & Manage", desc: "Track performance in real time and adjust parameters on the fly." },
];

const strategies = [
  { name: "Option Pulse Buying", type: "BUYING STRATEGY", min: "₹45,000", tag: "NIFTY" },
  { name: "Credit Spread PE", type: "CREDIT SPREAD", min: "₹85,000", tag: "NIFTY" },
  { name: "Nifty Trend Catcher", type: "DELTA BASED", min: "₹45,000", tag: "NIFTY" },
  { name: "Bank Nifty Bullish", type: "OPTIONS BUYING", min: "₹45,000", tag: "BANKNIFTY" },
  { name: "Momentum Buying", type: "INTRADAY", min: "₹40,000", tag: "NIFTY" },
  { name: "Nifty Short Strangle", type: "OPTIONS SELLING", min: "₹2,50,000", tag: "NIFTY" },
];

const highlights = [
  "No coding skills required",
  "80+ technical indicators",
  "Paper trading available",
  "Multiple simultaneous strategies",
  "SEBI-registered RA strategies",
  "Capital stays in your account",
];

export default function AlgoverseSection() {
  const sectionRef = useScrollReveal();

  return (
    <section id="algoverse" className="py-24 relative">
      {/* Background accent */}
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-[oklch(0.78_0.18_195/0.03)] to-transparent pointer-events-none" />

      <div className="container" ref={sectionRef}>
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[oklch(0.78_0.18_195/0.25)] bg-[oklch(0.78_0.18_195/0.06)] mb-5">
            <span className="text-xs font-medium text-[oklch(0.78_0.18_195)] tracking-widest uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>
              02 — Automation Platform
            </span>
          </div>
          <h2
            className="text-4xl md:text-5xl font-extrabold text-white mb-4 fade-up"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            Upstox <span className="gradient-text">Algoverse</span>
          </h2>
          <p className="text-white/55 text-base max-w-2xl mx-auto leading-relaxed fade-up">
            Build, backtest, and deploy algorithmic trading strategies without writing a single line of code. Access ready-made algos curated by SEBI-registered Research Analysts.
          </p>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {steps.map((s, i) => (
            <div
              key={s.step}
              className="glass-card teal-glow-hover rounded-2xl p-5 fade-up"
              style={{ transitionDelay: `${i * 0.1}s` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-[oklch(0.78_0.18_195/0.1)] border border-[oklch(0.78_0.18_195/0.2)] flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-[oklch(0.78_0.18_195)]" />
                </div>
                <span className="text-2xl font-black text-white/8" style={{ fontFamily: "'Syne', sans-serif" }}>
                  {s.step}
                </span>
              </div>
              <h4 className="text-white font-bold text-sm mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
                {s.title}
              </h4>
              <p className="text-white/45 text-xs leading-relaxed">{s.desc}</p>
            </div>
          ))}
        </div>

        {/* Two-column: Strategies + Highlights */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Strategy Cards */}
          <div className="fade-up">
            <h3 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "'Syne', sans-serif" }}>
              Ready-Made Strategies
            </h3>
            <div className="space-y-3">
              {strategies.map((s) => (
                <div
                  key={s.name}
                  className="glass-card teal-glow-hover rounded-xl px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <div className="text-white font-semibold text-sm">{s.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-white/35 font-mono">{s.type}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[oklch(0.78_0.18_195/0.1)] text-[oklch(0.78_0.18_195)] font-mono">
                        {s.tag}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/35 mb-0.5">Min. Capital</div>
                    <div className="text-sm font-bold text-[oklch(0.78_0.17_65)]" style={{ fontFamily: "'DM Mono', monospace" }}>
                      {s.min}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Highlights + Image */}
          <div className="fade-up" style={{ transitionDelay: "0.15s" }}>
            <h3 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "'Syne', sans-serif" }}>
              Why Algoverse?
            </h3>
            <div className="glass-card rounded-2xl overflow-hidden mb-4">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663595065530/YS6FuJbAdBfZuGVr8MgfrP/algo-trading-eUdfrYkYi3UkywJB8eEWAK.webp"
                alt="Algorithmic Trading Network"
                className="w-full h-40 object-cover"
              />
              <div className="p-5 grid grid-cols-2 gap-3">
                {highlights.map((h) => (
                  <div key={h} className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[oklch(0.78_0.18_195)] shrink-0" />
                    <span className="text-white/65 text-xs">{h}</span>
                  </div>
                ))}
              </div>
            </div>
            <a
              href="https://upstox.com/algoverse/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] font-bold text-sm hover:bg-[oklch(0.82_0.18_195)] transition-colors duration-200"
            >
              Explore Algoverse
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
