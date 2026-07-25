/**
 * Risk Calculator App — Precision Dark Finance theme (Upgraded with Competitor Features)
 * Design: Deep navy (#0D1B2A) base, electric teal (#00D4FF) accents, amber (#F59E0B) warnings
 * Typography: Syne (headings) + DM Sans (body) + DM Mono (numbers)
 *
 * NEW FEATURES (from competitor analysis):
 * 1. F&O Instrument Selector — Nifty/BankNifty/FinNifty with lot sizes pre-filled
 * 2. Lot-based calculations — Max Lots, Risk Per Lot, Actual Risk (rounded lots)
 * 3. Copy Results button — one-click clipboard copy
 * 4. Formula Explainer — shows the math behind each calculation
 * 5. Survive Consecutive Losses — already had, now more prominent
 * 6. Expectancy Calculator tab — win rate × R:R = system edge
 * 7. Pre-Trade Checklist tab — 10-point checklist before each trade
 * 8. Daily Loss Limit Tracker tab — set daily max loss, track remaining trades
 * 9. Trade Journal tab — log trades, track P&L and win rate
 * 10. Brokerage Comparison — Upstox vs Zerodha vs Angel One
 */

import { useState, useMemo, useCallback } from "react";
import {
  Zap, AlertTriangle, TrendingUp, TrendingDown, Info, RotateCcw,
  ChevronDown, ChevronUp, Copy, Check, BookOpen, Calculator,
  BarChart2, Target,
  Activity
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
type TradeType = "intraday" | "delivery" | "futures" | "options";
type Direction = "buy" | "sell";
type Tab = "calculator" | "expectancy";

interface Inputs {
  capital: string;
  riskPct: string;
  entryPrice: string;
  stopLossPrice: string;
  targetPrice: string;
  tradeType: TradeType;
  direction: Direction;
  instrument: string;
}


// ─── Instrument Data ──────────────────────────────────────────────────────────
const INSTRUMENTS = [
  { label: "Custom (Equity)", value: "custom", lotSize: 1, type: "equity" },
  // NSE lot sizes revised Jan 2026 (circular FAOP70616)
  { label: "Nifty 50 (Lot: 65)", value: "nifty", lotSize: 65, type: "index" },
  { label: "Bank Nifty (Lot: 30)", value: "banknifty", lotSize: 30, type: "index" },
  { label: "Fin Nifty (Lot: 60)", value: "finnifty", lotSize: 60, type: "index" },
  { label: "Midcap Nifty (Lot: 120)", value: "midcapnifty", lotSize: 120, type: "index" },
  { label: "Sensex (Lot: 20)", value: "sensex", lotSize: 20, type: "index" },
  { label: "Reliance (Lot: 250)", value: "reliance", lotSize: 250, type: "stock" },
  { label: "TCS (Lot: 150)", value: "tcs", lotSize: 150, type: "stock" },
  { label: "HDFC Bank (Lot: 550)", value: "hdfcbank", lotSize: 550, type: "stock" },
  { label: "Infosys (Lot: 400)", value: "infy", lotSize: 400, type: "stock" },
];

// ─── Brokerage Calculator ─────────────────────────────────────────────────────
function calcBrokerage(tradeType: TradeType, qty: number, price: number, broker: "upstox" | "zerodha" | "angel" = "upstox") {
  const turnover = qty * price;
  let brokerage = 0;

  const rates: Record<string, { intraday: number; delivery: number; futures: number; options: number }> = {
    upstox: { intraday: 0.0003, delivery: 0, futures: 0.0003, options: 20 },
    zerodha: { intraday: 0.0003, delivery: 0, futures: 0.0003, options: 20 },
    angel: { intraday: 0.0003, delivery: 0.0005, futures: 0.0003, options: 25 },
  };

  const r = rates[broker];
  if (tradeType === "intraday") brokerage = Math.min(20, turnover * r.intraday);
  else if (tradeType === "delivery") brokerage = broker === "angel" ? Math.min(20, turnover * r.delivery) : 0;
  else if (tradeType === "futures") brokerage = Math.min(20, turnover * r.futures);
  else if (tradeType === "options") brokerage = r.options;

  const stt = tradeType === "intraday" ? turnover * 0.00025
    : tradeType === "delivery" ? turnover * 0.001
    : tradeType === "futures" ? turnover * 0.0001
    : turnover * 0.0005;

  const exchangeFee = turnover * 0.0000345;
  const sebiCharges = turnover * 0.000001;
  const stampDuty = turnover * 0.00003;
  const gst = (brokerage + exchangeFee + sebiCharges) * 0.18;
  const total = brokerage + stt + exchangeFee + sebiCharges + stampDuty + gst;
  return { brokerage, stt, exchangeFee, sebiCharges, stampDuty, gst, total };
}

// ─── Pre-Trade Checklist Items ────────────────────────────────────────────────
const CHECKLIST_ITEMS = [
  { id: "sl", text: "Stop-loss level is defined and set in the system", category: "Risk" },
  { id: "target", text: "Target price is set with minimum 1:2 Risk:Reward", category: "Risk" },
  { id: "size", text: "Position size calculated — not more than 1% capital at risk", category: "Risk" },
  { id: "daily", text: "Daily loss limit not yet breached today", category: "Risk" },
  { id: "trend", text: "Trade is in the direction of the higher timeframe trend", category: "Technical" },
  { id: "volume", text: "Volume confirms the setup (not low-volume breakout)", category: "Technical" },
  { id: "news", text: "No major news/events expected during the trade window", category: "Macro" },
  { id: "margin", text: "Sufficient margin available in the account", category: "Account" },
  { id: "emotion", text: "Not trading out of revenge, FOMO, or boredom", category: "Psychology" },
  { id: "plan", text: "Exit plan is clear — know exactly when to exit (win or lose)", category: "Psychology" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function RiskBadge({ pct }: { pct: number }) {
  if (pct <= 1)
    return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[oklch(0.78_0.18_195/0.15)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.3)]">SAFE</span>;
  if (pct <= 2)
    return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[oklch(0.78_0.17_65/0.15)] text-[oklch(0.78_0.17_65)] border border-[oklch(0.78_0.17_65/0.3)]">MODERATE</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[oklch(0.65_0.22_25/0.15)] text-[oklch(0.65_0.22_25)] border border-[oklch(0.65_0.22_25/0.3)]">HIGH RISK</span>;
}

function InputField({ label, value, onChange, prefix, suffix, hint, type = "number", min, step }: {
  label: string; value: string; onChange: (v: string) => void;
  prefix?: string; suffix?: string; hint?: string; type?: string; min?: string; step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>{label}</label>
      <div className="flex items-center rounded-xl border border-white/10 bg-white/4 focus-within:border-[oklch(0.78_0.18_195/0.5)] focus-within:bg-[oklch(0.78_0.18_195/0.04)] transition-all duration-200 overflow-hidden">
        {prefix && <span className="px-3 text-white/40 text-sm border-r border-white/8 bg-white/3 h-full flex items-center py-3" style={{ fontFamily: "'DM Mono', monospace" }}>{prefix}</span>}
        <input type={type} value={value} min={min} step={step} onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent px-3 py-3 text-white text-sm outline-none placeholder:text-white/20 min-w-0" style={{ fontFamily: "'DM Mono', monospace" }} />
        {suffix && <span className="px-3 text-white/40 text-xs border-l border-white/8 bg-white/3 h-full flex items-center py-3">{suffix}</span>}
      </div>
      {hint && <p className="text-xs text-white/30">{hint}</p>}
    </div>
  );
}

function ResultRow({ label, value, color, large, sub }: {
  label: string; value: string; color?: string; large?: boolean; sub?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div>
        <span className="text-white/55 text-sm">{label}</span>
        {sub && <p className="text-white/25 text-xs mt-0.5">{sub}</p>}
      </div>
      <span className={`font-bold ${large ? "text-xl" : "text-sm"} ${color || "text-white"}`} style={{ fontFamily: "'DM Mono', monospace" }}>
        {value}
      </span>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200 whitespace-nowrap ${
        active ? "bg-[oklch(0.78_0.18_195/0.15)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.3)]"
               : "text-white/40 hover:text-white/70 border border-transparent"
      }`}>
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DEFAULT_INPUTS: Inputs = {
  capital: "100000", riskPct: "1", entryPrice: "", stopLossPrice: "",
  targetPrice: "", tradeType: "intraday", direction: "buy", instrument: "custom",
};

const TRADE_TYPES: { value: TradeType; label: string }[] = [
  { value: "intraday", label: "Intraday" },
  { value: "delivery", label: "Delivery" },
  { value: "futures", label: "Futures" },
  { value: "options", label: "Options" },
];

export default function RiskCalculator() {
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [showBrokerage, setShowBrokerage] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("calculator");

  // Checklist state

  // Journal state

  // Expectancy state
  const [expInputs, setExpInputs] = useState({ winRate: "50", avgWin: "2000", avgLoss: "1000", tradesPerMonth: "20" });

  // Daily Loss Tracker state

  const set = (key: keyof Inputs) => (val: string) => setInputs((prev) => ({ ...prev, [key]: val }));
  const reset = () => { setInputs(DEFAULT_INPUTS); setShowBrokerage(false); setShowFormula(false); };

  // Get lot size from selected instrument
  const selectedInstrument = INSTRUMENTS.find(i => i.value === inputs.instrument) || INSTRUMENTS[0];
  const lotSize = selectedInstrument.lotSize;

  // ── Core Calculations ────────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const capital = parseFloat(inputs.capital) || 0;
    const riskPct = parseFloat(inputs.riskPct) || 0;
    const entry = parseFloat(inputs.entryPrice) || 0;
    const sl = parseFloat(inputs.stopLossPrice) || 0;
    const target = parseFloat(inputs.targetPrice) || 0;

    if (!capital || !riskPct || !entry || !sl) return null;

    const maxRiskAmount = (capital * riskPct) / 100;
    const slDistance = Math.abs(entry - sl);
    if (slDistance === 0) return null;

    const slPct = (slDistance / entry) * 100;
    const rawQty = maxRiskAmount / slDistance;

    // Lot-based rounding (key competitor feature)
    const maxLots = Math.max(1, Math.floor(rawQty / lotSize));
    const qty = maxLots * lotSize;
    const riskPerLot = slDistance * lotSize;
    const actualRisk = qty * slDistance;
    const actualRiskPct = (actualRisk / capital) * 100;
    const positionValue = qty * entry;
    const capitalUsedPct = (positionValue / capital) * 100;

    // Target
    let profitAmount = 0, rrRatio = 0, targetPct = 0;
    if (target && target !== entry) {
      const targetDistance = Math.abs(target - entry);
      profitAmount = qty * targetDistance;
      rrRatio = targetDistance / slDistance;
      targetPct = (targetDistance / entry) * 100;
    }

    // Brokerage
    const entryBrok = calcBrokerage(inputs.tradeType, qty, entry);
    const exitBrok = calcBrokerage(inputs.tradeType, qty, sl);
    const totalBrokerage = entryBrok.total + exitBrok.total;
    const netProfit = profitAmount - totalBrokerage;
    const netLoss = -(actualRisk + totalBrokerage);
    const breakevenMove = totalBrokerage / qty;
    const breakevenPrice = inputs.direction === "buy" ? entry + breakevenMove : entry - breakevenMove;
    const lossTrades = actualRisk > 0 ? Math.floor((capital * 0.1) / actualRisk) : 0;

    // Brokerage comparison
    const upstoxTotal = entryBrok.total + exitBrok.total;
    const zerodhaTotal = calcBrokerage(inputs.tradeType, qty, entry, "zerodha").total + calcBrokerage(inputs.tradeType, qty, sl, "zerodha").total;
    const angelTotal = calcBrokerage(inputs.tradeType, qty, entry, "angel").total + calcBrokerage(inputs.tradeType, qty, sl, "angel").total;

    return {
      maxRiskAmount, qty, maxLots, riskPerLot, actualRisk, actualRiskPct,
      positionValue, capitalUsedPct, slDistance, slPct, profitAmount,
      netProfit, netLoss, rrRatio, targetPct, totalBrokerage, entryBrok,
      breakevenPrice, lossTrades, upstoxTotal, zerodhaTotal, angelTotal,
    };
  }, [inputs, lotSize]);

  // ── Expectancy Calculation ───────────────────────────────────────────────────
  const expectancy = useMemo(() => {
    const wr = parseFloat(expInputs.winRate) / 100 || 0;
    const lr = 1 - wr;
    const avgWin = parseFloat(expInputs.avgWin) || 0;
    const avgLoss = parseFloat(expInputs.avgLoss) || 0;
    const tpm = parseInt(expInputs.tradesPerMonth) || 0;
    const exp = (wr * avgWin) - (lr * avgLoss);
    const monthlyExp = exp * tpm;
    const rr = avgLoss > 0 ? avgWin / avgLoss : 0;
    const breakEvenWR = avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) * 100 : 0;
    return { exp, monthlyExp, rr, breakEvenWR };
  }, [expInputs]);
  const copyResults = () => {
    if (!calc) return;
    const text = `Position Size: ${calc.qty} qty\nRisk: ₹${calc.actualRisk.toFixed(0)}\nReward: ₹${calc.profitAmount.toFixed(0)}\nR:R = 1:${calc.rrRatio.toFixed(1)}`;
    navigator.clipboard.writeText(text);
    toast.success("Results copied!");
  };
  const isValid = !!calc;

  return (
    <div className="min-h-screen bg-[oklch(0.11_0.025_240)]">
      {/* Top Bar */}
      <header className="sticky top-0 z-50 bg-[oklch(0.11_0.025_240/0.95)] backdrop-blur-xl border-b border-white/5">
        <div className="container flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <Link href="/">
              <div className="flex items-center gap-2 cursor-pointer">
                <div className="w-7 h-7 rounded-lg bg-[oklch(0.78_0.18_195/0.15)] border border-[oklch(0.78_0.18_195/0.4)] flex items-center justify-center">
                  <Zap className="w-3.5 h-3.5 text-[oklch(0.78_0.18_195)]" />
                </div>
                <span className="text-white/50 text-sm hidden sm:block" style={{ fontFamily: "'Syne', sans-serif" }}>Upstox Hub</span>
              </div>
            </Link>
            <span className="text-white/20">/</span>
            <span className="text-white font-bold text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>Risk Calculator</span>
          </div>
          <div className="flex items-center gap-2">
            {isValid && (
              <button onClick={copyResults}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[oklch(0.78_0.18_195/0.3)] text-[oklch(0.78_0.18_195)] hover:bg-[oklch(0.78_0.18_195/0.1)] text-xs transition-all duration-200">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            )}
            <button onClick={reset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/20 text-xs transition-all duration-200">
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>
      </header>

      <div className="container py-4 sm:py-6 pb-24 md:pb-6">
        {/* Page Title */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-black text-white mb-1" style={{ fontFamily: "'Syne', sans-serif" }}>
            Scalping Risk Calculator
          </h1>
          <p className="text-white/40 text-sm">Professional-grade tools for disciplined trading</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1.5 mb-6 overflow-x-auto pb-1 scrollbar-hide">
          <TabButton active={activeTab === "calculator"} onClick={() => setActiveTab("calculator")} icon={Calculator} label="Calculator" />
          <TabButton active={activeTab === "expectancy"} onClick={() => setActiveTab("expectancy")} icon={Activity} label="Expectancy" />
        </div>

        {/* ── TAB: CALCULATOR ─────────────────────────────────────────────────── */}
        {activeTab === "calculator" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Inputs */}
            <div className="space-y-5">
              {/* Instrument Selector (NEW — from OneTradeJournal) */}
              <div className="glass-card rounded-2xl p-5 space-y-4">
                <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Instrument & Trade Type</h2>

                {/* Instrument Dropdown */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>Instrument</label>
                  <select value={inputs.instrument} onChange={e => set("instrument")(e.target.value)}
                    className="w-full bg-white/4 border border-white/10 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-[oklch(0.78_0.18_195/0.5)] transition-all duration-200 cursor-pointer"
                    style={{ fontFamily: "'DM Mono', monospace" }}>
                    {INSTRUMENTS.map(i => <option key={i.value} value={i.value} className="bg-[oklch(0.15_0.025_240)]">{i.label}</option>)}
                  </select>
                  {selectedInstrument.value !== "custom" && (
                    <p className="text-xs text-[oklch(0.78_0.18_195)]">Lot size: {lotSize} units — calculations rounded to nearest lot</p>
                  )}
                </div>

                {/* Trade Type */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>Trade Type</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {TRADE_TYPES.map(t => (
                      <button key={t.value} onClick={() => set("tradeType")(t.value)}
                        className={`py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          inputs.tradeType === t.value
                            ? "bg-[oklch(0.78_0.18_195/0.15)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.4)]"
                            : "bg-white/3 text-white/40 border border-white/8 hover:border-white/20 hover:text-white/60"
                        }`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Direction */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>Direction</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["buy", "sell"] as Direction[]).map(d => (
                      <button key={d} onClick={() => set("direction")(d)}
                        className={`py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 ${
                          inputs.direction === d
                            ? d === "buy"
                              ? "bg-[oklch(0.78_0.18_195/0.15)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.4)]"
                              : "bg-[oklch(0.65_0.22_25/0.15)] text-[oklch(0.65_0.22_25)] border border-[oklch(0.65_0.22_25/0.4)]"
                            : "bg-white/3 text-white/40 border border-white/8 hover:border-white/20"
                        }`}>
                        {d === "buy" ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                        {d.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Capital & Risk */}
              <div className="glass-card rounded-2xl p-5 space-y-4">
                <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Capital & Risk</h2>
                <div className="grid grid-cols-2 gap-3">
                  <InputField label="Trading Capital" value={inputs.capital} onChange={set("capital")} prefix="₹" hint="Your total account size" />
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-wider flex items-center gap-2" style={{ fontFamily: "'DM Mono', monospace" }}>
                      Risk % <RiskBadge pct={parseFloat(inputs.riskPct) || 0} />
                    </label>
                    <div className="flex items-center rounded-xl border border-white/10 bg-white/4 focus-within:border-[oklch(0.78_0.18_195/0.5)] transition-all duration-200 overflow-hidden">
                      <input type="number" value={inputs.riskPct} min="0.1" step="0.1" max="10"
                        onChange={e => set("riskPct")(e.target.value)}
                        className="flex-1 bg-transparent px-3 py-3 text-white text-sm outline-none min-w-0" style={{ fontFamily: "'DM Mono', monospace" }} />
                      <span className="px-3 text-white/40 text-xs border-l border-white/8 bg-white/3 h-full flex items-center py-3">%</span>
                    </div>
                    <p className="text-xs text-white/30">Max ₹{((parseFloat(inputs.capital) || 0) * (parseFloat(inputs.riskPct) || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })} at risk</p>
                  </div>
                </div>
              </div>

              {/* Price Levels */}
              <div className="glass-card rounded-2xl p-5 space-y-4">
                <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Price Levels</h2>
                <div className="grid grid-cols-1 gap-3">
                  <InputField label="Entry Price" value={inputs.entryPrice} onChange={set("entryPrice")} prefix="₹" hint="Your planned entry price" />
                  <InputField label="Stop-Loss Price" value={inputs.stopLossPrice} onChange={set("stopLossPrice")} prefix="₹" hint="Price where you exit if trade goes wrong" />
                  <InputField label="Target Price (optional)" value={inputs.targetPrice} onChange={set("targetPrice")} prefix="₹" hint="Your profit target — used for R:R calculation" />
                </div>
              </div>
            </div>

            {/* Right: Results */}
            <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs font-bold text-white/40 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Live Results</span>
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.18_195)] animate-pulse" />
                    <span className="text-xs text-[oklch(0.78_0.18_195)]">Live</span>
                    <button onClick={() => setShowFormula(!showFormula)}
                      className="ml-2 flex items-center gap-1 text-xs text-white/30 hover:text-white/60 transition-colors border border-white/10 rounded-md px-2 py-1">
                      <BookOpen className="w-3 h-3" />
                      Formula
                    </button>
                  </div>
                </div>

                {/* Formula Panel (NEW — from OneTradeJournal) */}
                {showFormula && (
                  <div className="px-5 py-4 bg-[oklch(0.78_0.18_195/0.04)] border-b border-white/5 space-y-2">
                    <p className="text-xs font-bold text-[oklch(0.78_0.18_195)] mb-2">How It's Calculated</p>
                    {[
                      ["Max Risk (₹)", "Capital × Risk% ÷ 100"],
                      ["Max Lots", "⌊ Max Risk ÷ (SL Distance × Lot Size) ⌋"],
                      ["Qty", "Max Lots × Lot Size"],
                      ["Risk Per Lot", "SL Distance × Lot Size"],
                      ["Position Value", "Qty × Entry Price"],
                      ["R:R Ratio", "Target Distance ÷ SL Distance"],
                      ["Breakeven", "Entry ± (Total Brokerage ÷ Qty)"],
                    ].map(([label, formula]) => (
                      <div key={label} className="flex items-start gap-3">
                        <span className="text-white/40 text-xs w-32 shrink-0">{label}</span>
                        <span className="text-white/60 text-xs font-mono">{formula}</span>
                      </div>
                    ))}
                  </div>
                )}

                {!isValid ? (
                  <div className="p-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-white/5 border border-white/8 flex items-center justify-center mx-auto mb-3">
                      <Info className="w-5 h-5 text-white/25" />
                    </div>
                    <p className="text-white/30 text-sm">Fill in Capital, Risk %, Entry Price, and Stop-Loss to see results.</p>
                  </div>
                ) : (
                  <div className="p-5">
                    {/* Hero: Lots + Qty */}
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="rounded-xl bg-[oklch(0.78_0.18_195/0.08)] border border-[oklch(0.78_0.18_195/0.2)] p-4 text-center">
                        <p className="text-xs text-[oklch(0.78_0.18_195)] uppercase tracking-widest mb-1" style={{ fontFamily: "'DM Mono', monospace" }}>Max Lots</p>
                        <p className="text-4xl font-black text-white" style={{ fontFamily: "'Syne', sans-serif" }}>{calc.maxLots}</p>
                        <p className="text-xs text-white/35 mt-1">{calc.qty} units</p>
                      </div>
                      <div className="rounded-xl bg-white/4 border border-white/8 p-4 text-center">
                        <p className="text-xs text-white/40 uppercase tracking-widest mb-1" style={{ fontFamily: "'DM Mono', monospace" }}>Risk / Lot</p>
                        <p className="text-2xl font-black text-[oklch(0.65_0.22_25)]" style={{ fontFamily: "'Syne', sans-serif" }}>₹{calc.riskPerLot.toFixed(0)}</p>
                        <p className="text-xs text-white/35 mt-1">per lot</p>
                      </div>
                    </div>

                    {/* Key Metrics */}
                    <div className="space-y-0">
                      <ResultRow label="Max Risk Amount" value={`₹${calc.actualRisk.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} color="text-[oklch(0.65_0.22_25)]" sub={`${calc.actualRiskPct.toFixed(2)}% of capital`} />
                      <ResultRow label="Position Value" value={`₹${calc.positionValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`} sub={`${calc.capitalUsedPct.toFixed(1)}% of capital used`} />
                      <ResultRow label="SL Distance" value={`₹${calc.slDistance.toFixed(2)}`} sub={`${calc.slPct.toFixed(2)}% from entry`} />
                      <ResultRow label="Breakeven Price" value={`₹${calc.breakevenPrice.toFixed(2)}`} sub="After brokerage (entry + exit)" />
                      {calc.rrRatio > 0 && (
                        <>
                          <ResultRow label="Risk : Reward" value={`1 : ${calc.rrRatio.toFixed(2)}`} color={calc.rrRatio >= 2 ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.78_0.17_65)]"} />
                          <ResultRow label="Net Profit (after brok.)" value={`₹${calc.netProfit.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} color={calc.netProfit > 0 ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.65_0.22_25)]"} large />
                        </>
                      )}
                      <ResultRow label="Net Loss (if SL hit)" value={`₹${Math.abs(calc.netLoss).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`} color="text-[oklch(0.65_0.22_25)]" large />
                    </div>
                  </div>
                )}
              </div>

              {/* Safety Insight */}
              {isValid && (
                <div className="glass-card rounded-2xl p-4 border border-[oklch(0.78_0.17_65/0.2)]">
                  <div className="flex gap-3">
                    <AlertTriangle className="w-4 h-4 text-[oklch(0.78_0.17_65)] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white/70 text-xs font-semibold mb-1">Capital Safety</p>
                      <p className="text-white/40 text-xs leading-relaxed">
                        You can absorb <span className="text-[oklch(0.78_0.17_65)] font-bold">{calc.lossTrades} consecutive losses</span> before losing 10% of capital.{" "}
                        {calc.lossTrades < 5 && <span className="text-[oklch(0.65_0.22_25)]">Consider reducing your risk % per trade.</span>}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Brokerage Breakdown + Comparison (NEW) */}
              {isValid && (
                <div className="glass-card rounded-2xl overflow-hidden">
                  <button onClick={() => setShowBrokerage(!showBrokerage)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-white/3 transition-colors duration-200">
                    <span className="text-xs font-bold text-white/50 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Brokerage Breakdown</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[oklch(0.78_0.17_65)]" style={{ fontFamily: "'DM Mono', monospace" }}>₹{calc.totalBrokerage.toFixed(2)}</span>
                      {showBrokerage ? <ChevronUp className="w-4 h-4 text-white/30" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
                    </div>
                  </button>
                  {showBrokerage && (
                    <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                      {[
                        { label: "Brokerage (entry + exit)", val: (calc.entryBrok.brokerage * 2).toFixed(2) },
                        { label: "STT", val: (calc.entryBrok.stt * 2).toFixed(2) },
                        { label: "Exchange Fees", val: (calc.entryBrok.exchangeFee * 2).toFixed(2) },
                        { label: "SEBI Charges", val: (calc.entryBrok.sebiCharges * 2).toFixed(4) },
                        { label: "Stamp Duty", val: (calc.entryBrok.stampDuty * 2).toFixed(2) },
                        { label: "GST (18%)", val: (calc.entryBrok.gst * 2).toFixed(2) },
                      ].map(r => (
                        <div key={r.label} className="flex justify-between">
                          <span className="text-white/35 text-xs">{r.label}</span>
                          <span className="text-white/55 text-xs font-mono">₹{r.val}</span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2 border-t border-white/8">
                        <span className="text-white/60 text-xs font-semibold">Total (Upstox)</span>
                        <span className="text-[oklch(0.78_0.17_65)] text-xs font-bold font-mono">₹{calc.upstoxTotal.toFixed(2)}</span>
                      </div>
                      {/* Broker Comparison (NEW) */}
                      <div className="mt-3 pt-3 border-t border-white/5">
                        <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-2">Broker Comparison</p>
                        {[
                          { name: "Upstox", val: calc.upstoxTotal },
                          { name: "Zerodha", val: calc.zerodhaTotal },
                          { name: "Angel One", val: calc.angelTotal },
                        ].map(b => (
                          <div key={b.name} className="flex justify-between items-center py-1">
                            <span className="text-white/40 text-xs">{b.name}</span>
                            <span className={`text-xs font-mono font-bold ${b.val === Math.min(calc.upstoxTotal, calc.zerodhaTotal, calc.angelTotal) ? "text-[oklch(0.78_0.18_195)]" : "text-white/40"}`}>
                              ₹{b.val.toFixed(2)} {b.val === Math.min(calc.upstoxTotal, calc.zerodhaTotal, calc.angelTotal) && "✓ Cheapest"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <p className="text-white/20 text-xs text-center leading-relaxed px-2">
                For educational purposes only. Not financial advice. Verify with your broker before trading.
              </p>
            </div>
          </div>
        )}

        {/* ── TAB: EXPECTANCY CALCULATOR ───────────────────────────────────────── */}
        {activeTab === "expectancy" && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-lg font-black text-white mb-1" style={{ fontFamily: "'Syne', sans-serif" }}>Trading Expectancy Calculator</h2>
              <p className="text-white/40 text-sm mb-5">Measures your system's edge. Positive expectancy = profitable system.</p>

              <div className="grid grid-cols-2 gap-4 mb-5">
                {[
                  { label: "Win Rate (%)", key: "winRate", suffix: "%" },
                  { label: "Avg Win (₹)", key: "avgWin", suffix: "₹" },
                  { label: "Avg Loss (₹)", key: "avgLoss", suffix: "₹" },
                  { label: "Trades / Month", key: "tradesPerMonth", suffix: "" },
                ].map(f => (
                  <div key={f.key} className="space-y-1.5">
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>{f.label}</label>
                    <input type="number" value={expInputs[f.key as keyof typeof expInputs]}
                      onChange={e => setExpInputs(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full bg-white/4 border border-white/10 rounded-xl px-3 py-3 text-white text-sm outline-none focus:border-[oklch(0.78_0.18_195/0.5)] transition-all duration-200"
                      style={{ fontFamily: "'DM Mono', monospace" }} />
                  </div>
                ))}
              </div>

              {/* Results */}
              <div className="rounded-2xl border p-5 text-center mb-4"
                style={{ borderColor: expectancy.exp > 0 ? "oklch(0.78 0.18 195 / 0.3)" : "oklch(0.65 0.22 25 / 0.3)" }}>
                <p className="text-xs text-white/40 uppercase tracking-widest mb-2" style={{ fontFamily: "'DM Mono', monospace" }}>Expectancy Per Trade</p>
                <p className="text-5xl font-black mb-1" style={{ fontFamily: "'Syne', sans-serif",
                  color: expectancy.exp > 0 ? "oklch(0.78 0.18 195)" : "oklch(0.65 0.22 25)" }}>
                  ₹{expectancy.exp.toFixed(0)}
                </p>
                <p className={`text-sm font-bold ${expectancy.exp > 0 ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.65_0.22_25)]"}`}>
                  {expectancy.exp > 0 ? "✓ Positive Edge — Profitable System" : "✗ Negative Edge — Fix Your System First"}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Monthly Expectancy", value: `₹${expectancy.monthlyExp.toFixed(0)}`, color: expectancy.monthlyExp > 0 ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.65_0.22_25)]" },
                  { label: "R:R Ratio", value: `1 : ${expectancy.rr.toFixed(2)}`, color: expectancy.rr >= 2 ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.78_0.17_65)]" },
                  { label: "Breakeven Win Rate", value: `${expectancy.breakEvenWR.toFixed(1)}%`, color: "text-white" },
                ].map(s => (
                  <div key={s.label} className="rounded-xl bg-white/4 border border-white/8 p-3 text-center">
                    <p className="text-xs text-white/35 mb-1">{s.label}</p>
                    <p className={`text-lg font-black ${s.color}`} style={{ fontFamily: "'Syne', sans-serif" }}>{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-3 rounded-xl bg-white/3 border border-white/6">
                <p className="text-xs text-white/40 leading-relaxed">
                  <span className="text-white/60 font-semibold">Formula:</span> Expectancy = (Win Rate × Avg Win) − (Loss Rate × Avg Loss). A positive number means your system makes money on average. Aim for at least ₹500+ per trade expectancy before trading real money.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
