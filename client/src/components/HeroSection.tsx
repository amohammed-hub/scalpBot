import { ArrowRight, Zap, Shield, BarChart2 } from "lucide-react";
import { useEffect, useRef } from "react";

const stats = [
  { label: "Order Execution", value: "<45ms", icon: Zap, color: "text-[oklch(0.78_0.18_195)]" },
  { label: "API Uptime", value: "99.9%", icon: BarChart2, color: "text-[oklch(0.78_0.17_65)]" },
  { label: "API Cost", value: "₹0 Free", icon: Shield, color: "text-[oklch(0.78_0.18_195)]" },
];

export default function HeroSection() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Trigger all fade-up elements with staggered delay
    const fadeEls = el.querySelectorAll(".fade-up");
    fadeEls.forEach((fadeEl, i) => {
      setTimeout(() => {
        fadeEl.classList.add("visible");
      }, 150 + i * 120);
    });
  }, []);

  return (
    <section className="relative min-h-screen flex flex-col justify-center overflow-hidden">
      {/* Background image */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(https://d2xsxph8kpxj0f.cloudfront.net/310519663595065530/YS6FuJbAdBfZuGVr8MgfrP/hero-bg-PZJhNe5tvZt7WRvo6itUfm.webp)`,
        }}
      />
      {/* Dark overlay gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[oklch(0.11_0.025_240/0.85)] via-[oklch(0.11_0.025_240/0.65)] to-[oklch(0.11_0.025_240)]" />
      {/* Left gradient fade */}
      <div className="absolute inset-0 bg-gradient-to-r from-[oklch(0.11_0.025_240/0.92)] via-[oklch(0.11_0.025_240/0.5)] to-transparent" />

      {/* Content */}
      <div className="relative z-10 container pt-28 pb-20" ref={containerRef}>
        <div className="max-w-3xl">
          {/* Badge */}
          <div className="fade-up inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[oklch(0.78_0.18_195/0.35)] bg-[oklch(0.78_0.18_195/0.1)] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.18_195)] pulse-glow" />
            <span className="text-xs font-medium text-[oklch(0.78_0.18_195)] tracking-wider uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>
              Live Trading Resource
            </span>
          </div>

          {/* Headline */}
          <h1
            className="text-5xl md:text-7xl font-extrabold leading-tight mb-6 fade-up"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            <span className="text-white">Master</span>
            <br />
            <span className="gradient-text">Scalping</span>
            <br />
            <span className="text-white">with Upstox</span>
          </h1>

          {/* Subheadline */}
          <p className="text-lg text-white/65 max-w-xl leading-relaxed mb-8 fade-up">
            Your complete guide to integrating apps, automating strategies, and managing risk — built for Indian retail traders using Upstox.
          </p>

          {/* CTAs */}
          <div className="flex flex-wrap gap-4 mb-14 fade-up">
            <a
              href="https://upstox.com/scalper/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] font-bold text-sm hover:bg-[oklch(0.82_0.18_195)] transition-all duration-200 shadow-lg shadow-[oklch(0.78_0.18_195/0.3)]"
            >
              Start Scalping Now
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="https://upstox.com/algoverse/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-6 py-3 rounded-xl border border-white/20 text-white/85 font-semibold text-sm hover:border-[oklch(0.78_0.18_195/0.5)] hover:text-white transition-all duration-200 bg-white/5"
            >
              Explore Algoverse
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-8 fade-up">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/6 border border-white/12 flex items-center justify-center">
                  <stat.icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div>
                  <div className={`text-xl font-bold ${stat.color}`} style={{ fontFamily: "'DM Mono', monospace" }}>
                    {stat.value}
                  </div>
                  <div className="text-xs text-white/40">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[oklch(0.11_0.025_240)] to-transparent" />
    </section>
  );
}
