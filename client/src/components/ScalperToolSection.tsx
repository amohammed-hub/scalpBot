import { Monitor, Crosshair, Layers, ArrowRight } from "lucide-react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const features = [
  {
    icon: Monitor,
    title: "Single-Screen Overview",
    desc: "See the full market picture — charts, order book, positions, and P&L — all on one unified screen without switching tabs.",
  },
  {
    icon: Crosshair,
    title: "Breakout/Breakdown Signals",
    desc: "Make better entry and exit decisions with real-time breakout and breakdown detection, reducing false signals.",
  },
  {
    icon: Layers,
    title: "Instant Market Reaction",
    desc: "React to changing market conditions instantly. The Scalper terminal is built for sub-second decision making.",
  },
];

export default function ScalperToolSection() {
  const sectionRef = useScrollReveal();

  return (
    <section id="scalper" className="py-24 relative">
      <div className="container">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Content */}
          <div ref={sectionRef}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[oklch(0.78_0.18_195/0.25)] bg-[oklch(0.78_0.18_195/0.06)] mb-5">
              <span className="text-xs font-medium text-[oklch(0.78_0.18_195)] tracking-widest uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>
                01 — Native Tool
              </span>
            </div>
            <h2
              className="text-4xl md:text-5xl font-extrabold text-white mb-4 leading-tight fade-up"
              style={{ fontFamily: "'Syne', sans-serif" }}
            >
              Upstox <span className="gradient-text">Scalper</span> Terminal
            </h2>
            <p className="text-white/55 text-base leading-relaxed mb-8 fade-up">
              Upstox's dedicated Scalper terminal is purpose-built for high-frequency intraday traders. It consolidates everything you need into a single, distraction-free interface — giving you the speed and clarity to act before the market moves.
            </p>

            <div className="space-y-5 mb-8">
              {features.map((f, i) => (
                <div
                  key={f.title}
                  className="flex gap-4 fade-up"
                  style={{ transitionDelay: `${i * 0.1}s` }}
                >
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-[oklch(0.78_0.18_195/0.1)] border border-[oklch(0.78_0.18_195/0.2)] flex items-center justify-center">
                    <f.icon className="w-5 h-5 text-[oklch(0.78_0.18_195)]" />
                  </div>
                  <div>
                    <h4 className="text-white font-semibold text-sm mb-1" style={{ fontFamily: "'Syne', sans-serif" }}>
                      {f.title}
                    </h4>
                    <p className="text-white/50 text-sm leading-relaxed">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <a
              href="https://upstox.com/scalper/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] font-bold text-sm hover:bg-[oklch(0.82_0.18_195)] transition-colors duration-200"
            >
              Try Scalper Terminal
              <ArrowRight className="w-4 h-4" />
            </a>
          </div>

          {/* Right: Image */}
          <div className="relative fade-up hidden lg:block">
            <div className="rounded-2xl overflow-hidden border border-white/8 shadow-2xl shadow-black/50">
              <img
                src="https://d2xsxph8kpxj0f.cloudfront.net/310519663595065530/YS6FuJbAdBfZuGVr8MgfrP/scalper-tool-N29CaNRaYwAtFvWqHnttg8.webp"
                alt="Upstox Scalper Terminal Interface"
                className="w-full h-auto"
              />
            </div>
            {/* Floating badge */}
            <div className="absolute -bottom-4 -left-4 glass-card rounded-xl px-4 py-3 border border-[oklch(0.78_0.18_195/0.25)]">
              <div className="text-xs text-white/50 mb-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>Execution Speed</div>
              <div className="text-xl font-bold text-[oklch(0.78_0.18_195)]" style={{ fontFamily: "'DM Mono', monospace" }}>&lt;45ms</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
