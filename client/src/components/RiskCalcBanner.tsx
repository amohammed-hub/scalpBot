import { Calculator, ArrowRight, Shield } from "lucide-react";
import { Link } from "wouter";

export default function RiskCalcBanner() {
  return (
    <div className="container py-6">
      <Link href="/risk-calculator">
        <div className="group relative rounded-2xl border border-[oklch(0.78_0.18_195/0.3)] bg-gradient-to-r from-[oklch(0.78_0.18_195/0.08)] via-[oklch(0.78_0.18_195/0.05)] to-[oklch(0.78_0.17_65/0.06)] p-5 flex items-center justify-between gap-4 cursor-pointer hover:border-[oklch(0.78_0.18_195/0.55)] hover:from-[oklch(0.78_0.18_195/0.12)] transition-all duration-300 overflow-hidden">
          {/* Glow effect */}
          <div className="absolute -top-6 -left-6 w-24 h-24 rounded-full bg-[oklch(0.78_0.18_195/0.08)] blur-2xl group-hover:bg-[oklch(0.78_0.18_195/0.15)] transition-all duration-300" />

          <div className="flex items-center gap-4 relative z-10">
            <div className="w-11 h-11 rounded-xl bg-[oklch(0.78_0.18_195/0.15)] border border-[oklch(0.78_0.18_195/0.35)] flex items-center justify-center shrink-0 pulse-glow">
              <Calculator className="w-5 h-5 text-[oklch(0.78_0.18_195)]" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-white font-bold text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
                  Risk Calculator App
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-[oklch(0.78_0.18_195/0.15)] text-[oklch(0.78_0.18_195)] text-xs font-bold border border-[oklch(0.78_0.18_195/0.3)]" style={{ fontFamily: "'DM Mono', monospace" }}>
                  NEW
                </span>
              </div>
              <p className="text-white/45 text-xs">
                Calculate position size, stop-loss, R:R ratio &amp; brokerage — instantly
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 relative z-10 shrink-0">
            <div className="hidden sm:flex items-center gap-4">
              {["Position Size", "SL Distance", "Net P&L"].map((tag) => (
                <div key={tag} className="flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-[oklch(0.78_0.18_195/0.6)]" />
                  <span className="text-white/35 text-xs">{tag}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] text-xs font-bold group-hover:bg-[oklch(0.82_0.18_195)] transition-colors duration-200">
              Open App
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" />
            </div>
          </div>
        </div>
      </Link>
    </div>
  );
}
