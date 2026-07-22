import { Scale, Lock, Server, FileCheck, AlertCircle } from "lucide-react";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const timeline = [
  { date: "Feb 4, 2025", body: "SEBI", event: "Master Framework", desc: "Defined roles, API structure, and accountability for brokers, vendors, and exchanges." },
  { date: "May 5, 2025", body: "NSE", event: "Implementation Standards", desc: "Technical blueprint — static IPs, API keys, 10 OPS threshold, authentication rules." },
  { date: "Jul 22, 2025", body: "NSE", event: "Operational Modalities", desc: "Deep procedural details on empanelment, registration, testing, and operational audits." },
  { date: "Sep 30, 2025", body: "SEBI", event: "Extension & Glide Path", desc: "Phased rollout with milestones till April 1, 2026 for smooth implementation." },
  { date: "Apr 1, 2026", body: "LIVE", event: "Full Compliance Required", desc: "All retail algo trading must comply with the complete SEBI framework." },
];

const rules = [
  {
    icon: Lock,
    title: "API Security Stack",
    items: ["OAuth-based authentication (mandatory)", "Two-Factor Authentication (2FA)", "Static IP whitelisting", "Unique API keys per client/vendor"],
  },
  {
    icon: Server,
    title: "Order Limits",
    items: ["Below 10 OPS: no registration needed", "Above 10 OPS: mandatory registration", "All algos hosted on Indian servers", "Daily session auto-logout required"],
  },
  {
    icon: FileCheck,
    title: "Algo Classification",
    items: ["White-Box: logic visible to user", "Black-Box: requires SEBI RA registration", "All algos need exchange-assigned unique IDs", "Audit trail maintained for 5 years"],
  },
  {
    icon: Scale,
    title: "Broker Accountability",
    items: ["Brokers act as compliance gatekeepers", "Must work with empanelled algo vendors", "Exchange approval for every algo", "Kill switch capability mandatory"],
  },
];

export default function SEBISection() {
  const sectionRef = useScrollReveal();

  return (
    <section id="sebi" className="py-24 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[oklch(0.78_0.17_65/0.02)] to-transparent pointer-events-none" />

      <div className="container" ref={sectionRef}>
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[oklch(0.65_0.22_25/0.35)] bg-[oklch(0.65_0.22_25/0.08)] mb-5">
            <AlertCircle className="w-3 h-3 text-[oklch(0.65_0.22_25)]" />
            <span className="text-xs font-medium text-[oklch(0.65_0.22_25)] tracking-widest uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>
              05 — Regulatory Compliance
            </span>
          </div>
          <h2
            className="text-4xl md:text-5xl font-extrabold text-white mb-4 fade-up"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            SEBI <span className="gradient-text">Algo Rules</span> 2025–2026
          </h2>
          <p className="text-white/55 text-base max-w-2xl mx-auto leading-relaxed fade-up">
            SEBI has established a comprehensive framework for retail algorithmic trading. Understanding these rules ensures your automated strategies remain compliant and your account stays protected.
          </p>
        </div>

        {/* Timeline */}
        <div className="mb-16 fade-up">
          <h3 className="text-lg font-bold text-white mb-6" style={{ fontFamily: "'Syne', sans-serif" }}>
            Regulatory Timeline
          </h3>
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[5.5rem] top-0 bottom-0 w-px bg-gradient-to-b from-[oklch(0.78_0.18_195/0.4)] via-[oklch(0.78_0.18_195/0.2)] to-transparent" />
            <div className="space-y-6">
              {timeline.map((t, i) => (
                <div key={i} className="flex gap-6 items-start">
                  <div className="w-20 shrink-0 text-right">
                    <span className="text-xs text-white/35 font-mono leading-tight">{t.date}</span>
                  </div>
                  <div className="relative flex items-center justify-center w-3 h-3 mt-1 shrink-0">
                    <div
                      className={`w-3 h-3 rounded-full border-2 ${
                        t.body === "LIVE"
                          ? "bg-[oklch(0.78_0.17_65)] border-[oklch(0.78_0.17_65)]"
                          : "bg-[oklch(0.11_0.025_240)] border-[oklch(0.78_0.18_195)]"
                      }`}
                    />
                  </div>
                  <div className="glass-card teal-glow-hover rounded-xl px-4 py-3 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
                          t.body === "LIVE"
                            ? "bg-[oklch(0.78_0.17_65/0.15)] text-[oklch(0.78_0.17_65)]"
                            : t.body === "SEBI"
                            ? "bg-[oklch(0.65_0.22_25/0.15)] text-[oklch(0.65_0.22_25)]"
                            : "bg-[oklch(0.78_0.18_195/0.1)] text-[oklch(0.78_0.18_195)]"
                        }`}
                      >
                        {t.body}
                      </span>
                      <span className="text-white font-semibold text-sm">{t.event}</span>
                    </div>
                    <p className="text-white/45 text-xs leading-relaxed">{t.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rules Grid */}
        <div className="grid md:grid-cols-2 gap-5">
          {rules.map((r, i) => (
            <div
              key={r.title}
              className="glass-card teal-glow-hover rounded-2xl p-6 fade-up"
              style={{ transitionDelay: `${i * 0.1}s` }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-[oklch(0.78_0.18_195/0.1)] border border-[oklch(0.78_0.18_195/0.2)] flex items-center justify-center">
                  <r.icon className="w-4 h-4 text-[oklch(0.78_0.18_195)]" />
                </div>
                <h4 className="text-white font-bold text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
                  {r.title}
                </h4>
              </div>
              <ul className="space-y-2">
                {r.items.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-[oklch(0.78_0.18_195)] mt-2 shrink-0" />
                    <span className="text-white/55 text-sm leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="mt-8 glass-card rounded-xl px-5 py-4 border border-[oklch(0.65_0.22_25/0.2)] fade-up">
          <div className="flex gap-3">
            <AlertCircle className="w-4 h-4 text-[oklch(0.65_0.22_25)] shrink-0 mt-0.5" />
            <p className="text-white/45 text-xs leading-relaxed">
              <strong className="text-white/65">Disclaimer:</strong> Investments in the securities market are subject to market risks. Scalping and algorithmic trading involve significant risk and may not be suitable for all investors. Always read all related documents carefully before investing. Past performance of any strategy does not guarantee future results.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
