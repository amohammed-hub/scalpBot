import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Bot, TrendingUp, Shield, Zap, BarChart2, QrCode } from "lucide-react";
import { useState } from "react";
import QRModal from "@/components/QRModal";

export default function Home() {
  const [, navigate] = useLocation();
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_240)] text-white">
      {/* Navbar */}
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-teal-500 rounded-lg flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg text-white">ScalpBot</span>
          <span className="text-xs bg-teal-500/20 text-teal-400 px-2 py-0.5 rounded-full border border-teal-500/30">Upstox</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setQrOpen(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-teal-500/15 border border-teal-500/30 text-teal-400 hover:bg-teal-500/25 transition-all"
          >
            <QrCode className="w-4 h-4" />
            <span className="hidden sm:inline">Get on Phone</span>
          </button>
          <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={() => navigate("/dashboard")}>
            Open Dashboard
          </Button>
        </div>
      </nav>
      <QRModal open={qrOpen} onClose={() => setQrOpen(false)} />

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-teal-500/10 border border-teal-500/30 rounded-full px-4 py-1.5 text-teal-400 text-sm mb-6">
          <span className="w-2 h-2 bg-teal-400 rounded-full animate-pulse" />
          Fully Automated Scalping Bot — Powered by EMA + VWAP + ADX
        </div>
        <h1 className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight">
          Let the Bot Trade.<br />
          <span className="text-teal-400">You Just Watch the Profits.</span>
        </h1>
        <p className="text-xl text-white/60 mb-10 max-w-2xl mx-auto">
          Connect your Upstox account, configure your risk settings, and let the AI-powered scalping bot automatically detect signals and place orders — no login required, no account needed.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" className="bg-teal-500 hover:bg-teal-600 text-white px-8 py-6 text-lg" onClick={() => navigate("/dashboard")}>
            <Bot className="w-5 h-5 mr-2" />
            Start Bot Trading Free
          </Button>
          <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 px-8 py-6 text-lg" onClick={() => navigate("/risk-calculator")}>
            <BarChart2 className="w-5 h-5 mr-2" />
            Try Risk Calculator
          </Button>
        </div>
      </div>

      {/* Features */}
      <div className="max-w-6xl mx-auto px-6 pb-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            { icon: Bot, title: "No Login Required", desc: "Open the app and start immediately. Your API credentials are stored securely in your browser — never sent to any server.", color: "teal" },
            { icon: Shield, title: "Built-in Risk Management", desc: "ATR-based dynamic stop-loss, daily loss limit circuit breaker, 1% risk rule, and max trades per day — all enforced automatically.", color: "amber" },
            { icon: TrendingUp, title: "Paper Trade First", desc: "Test your strategy with simulated trades before risking real money. Switch to live mode only when you're confident.", color: "purple" },
          ].map((f) => (
            <div key={f.title} className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-teal-500/40 transition-colors">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${f.color === "teal" ? "bg-teal-500/20" : f.color === "amber" ? "bg-amber-500/20" : "bg-purple-500/20"}`}>
                <f.icon className={`w-6 h-6 ${f.color === "teal" ? "text-teal-400" : f.color === "amber" ? "text-amber-400" : "text-purple-400"}`} />
              </div>
              <h3 className="font-semibold text-white text-lg mb-2">{f.title}</h3>
              <p className="text-white/60 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="mt-16 text-center">
          <h2 className="text-3xl font-bold text-white mb-3">How It Works</h2>
          <p className="text-white/50 mb-10">Three steps from setup to automated trading</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { step: "01", title: "Enter API Keys", desc: "Go to Settings, enter your Upstox API Key and Secret. Stored only in your browser — never on any server." },
              { step: "02", title: "Configure & Start", desc: "Choose your instrument (NIFTY, RELIANCE, etc.), set capital and risk %, then click Start Bot." },
              { step: "03", title: "Bot Trades Automatically", desc: "The bot scans every minute, generates EMA+VWAP+ADX signals, and places orders. You watch the live dashboard." },
            ].map((s) => (
              <div key={s.step} className="relative bg-white/5 border border-white/10 rounded-2xl p-6">
                <div className="text-5xl font-black text-teal-500/20 mb-3">{s.step}</div>
                <h3 className="font-semibold text-white text-lg mb-2">{s.title}</h3>
                <p className="text-white/60 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-16 bg-amber-500/10 border border-amber-500/30 rounded-xl p-5 text-center">
          <p className="text-amber-400/80 text-sm">
            <strong className="text-amber-400">Disclaimer:</strong> This is an educational tool. Trading involves significant risk. Always start with Paper Trade mode. Past performance does not guarantee future results. Not SEBI-registered financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
