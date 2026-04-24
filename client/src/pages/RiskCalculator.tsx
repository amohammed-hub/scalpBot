/**
 * Risk Calculator App — Precision Dark Finance theme
 * Design: Deep navy (#0D1B2A) base, electric teal (#00D4FF) accents, amber (#F59E0B) warnings
 * Typography: Syne (headings) + DM Sans (body) + DM Mono (numbers)
 * Layout: Two-column — inputs left, live results right (sticky)
 */

import { useState, useMemo } from "react";
import { Zap, AlertTriangle, TrendingUp, TrendingDown, Info, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────
type TradeType = "intraday" | "delivery" | "futures" | "options";
type Direction = "buy" | "sell";

interface Inputs {
  capital: string;
  riskPct: string;
  entryPrice: string;
  stopLossPrice: string;
  targetPrice: string;
  tradeType: TradeType;
  direction: Direction;
  lotSize: string;
}

// ─── Brokerage Calculator (Upstox rates) ──────────────────────────────────────
function calcBrokerage(tradeType: TradeType, qty: number, price: number) {
  const turnover = qty * price;
  let brokerage = 0;

  if (tradeType === "intraday") {
    brokerage = Math.min(20, turnover * 0.0003); // ₹20 or 0.03% whichever lower
  } else if (tradeType === "delivery") {
    brokerage = 0; // Upstox free delivery
  } else if (tradeType === "futures") {
    brokerage = Math.min(20, turnover * 0.0003);
  } else if (tradeType === "options") {
    brokerage = 20; // flat ₹20 per order
  }

  // STT (Securities Transaction Tax)
  let stt = 0;
  if (tradeType === "intraday") stt = turnover * 0.00025;
  else if (tradeType === "delivery") stt = turnover * 0.001;
  else if (tradeType === "futures") stt = turnover * 0.0001;
  else if (tradeType === "options") stt = turnover * 0.0005;

  const exchangeFee = turnover * 0.0000345;
  const sebiCharges = turnover * 0.000001;
  const stampDuty = turnover * 0.00003;
  const gst = (brokerage + exchangeFee + sebiCharges) * 0.18;

  const total = brokerage + stt + exchangeFee + sebiCharges + stampDuty + gst;
  return { brokerage, stt, exchangeFee, sebiCharges, stampDuty, gst, total };
}

// ─── Risk Level Badge ─────────────────────────────────────────────────────────
function RiskBadge({ pct }: { pct: number }) {
  if (pct <= 1)
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[oklch(0.78_0.18_195/0.15)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.3)]">
        SAFE
      </span>
    );
  if (pct <= 2)
    return (
      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[oklch(0.78_0.17_65/0.15)] text-[oklch(0.78_0.17_65)] border border-[oklch(0.78_0.17_65/0.3)]">
        MODERATE
      </span>
    );
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[oklch(0.65_0.22_25/0.15)] text-[oklch(0.65_0.22_25)] border border-[oklch(0.65_0.22_25/0.3)]">
      HIGH RISK
    </span>
  );
}

// ─── Input Field ──────────────────────────────────────────────────────────────
function InputField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  type = "number",
  min,
  step,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  hint?: string;
  type?: string;
  min?: string;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>
        {label}
      </label>
      <div className="flex items-center gap-0 rounded-xl border border-white/10 bg-white/4 focus-within:border-[oklch(0.78_0.18_195/0.5)] focus-within:bg-[oklch(0.78_0.18_195/0.04)] transition-all duration-200 overflow-hidden">
        {prefix && (
          <span className="px-3 text-white/40 text-sm border-r border-white/8 bg-white/3 h-full flex items-center py-3" style={{ fontFamily: "'DM Mono', monospace" }}>
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          min={min}
          step={step}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent px-3 py-3 text-white text-sm outline-none placeholder:text-white/20 min-w-0"
          style={{ fontFamily: "'DM Mono', monospace" }}
        />
        {suffix && (
          <span className="px-3 text-white/40 text-xs border-l border-white/8 bg-white/3 h-full flex items-center py-3">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-white/30">{hint}</p>}
    </div>
  );
}

// ─── Result Row ───────────────────────────────────────────────────────────────
function ResultRow({
  label,
  value,
  color,
  large,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  large?: boolean;
  sub?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div>
        <span className="text-white/55 text-sm">{label}</span>
        {sub && <p className="text-white/25 text-xs mt-0.5">{sub}</p>}
      </div>
      <span
        className={`font-bold ${large ? "text-xl" : "text-sm"} ${color || "text-white"}`}
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DEFAULT_INPUTS: Inputs = {
  capital: "100000",
  riskPct: "1",
  entryPrice: "",
  stopLossPrice: "",
  targetPrice: "",
  tradeType: "intraday",
  direction: "buy",
  lotSize: "1",
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

  const set = (key: keyof Inputs) => (val: string) =>
    setInputs((prev) => ({ ...prev, [key]: val }));

  const reset = () => setInputs(DEFAULT_INPUTS);

  // ── Core Calculations ──────────────────────────────────────────────────────
  const calc = useMemo(() => {
    const capital = parseFloat(inputs.capital) || 0;
    const riskPct = parseFloat(inputs.riskPct) || 0;
    const entry = parseFloat(inputs.entryPrice) || 0;
    const sl = parseFloat(inputs.stopLossPrice) || 0;
    const target = parseFloat(inputs.targetPrice) || 0;
    const lotSize = parseInt(inputs.lotSize) || 1;

    if (!capital || !riskPct || !entry || !sl) {
      return null;
    }

    const maxRiskAmount = (capital * riskPct) / 100;
    const slDistance = Math.abs(entry - sl);

    if (slDistance === 0) return null;

    const slPct = (slDistance / entry) * 100;
    const rawQty = maxRiskAmount / slDistance;
    // Round to nearest lot size
    const qty = Math.max(lotSize, Math.floor(rawQty / lotSize) * lotSize);
    const actualRisk = qty * slDistance;
    const actualRiskPct = (actualRisk / capital) * 100;
    const positionValue = qty * entry;
    const capitalUsedPct = (positionValue / capital) * 100;

    // Target calculations
    let profitAmount = 0;
    let rrRatio = 0;
    let targetPct = 0;
    if (target && target !== entry) {
      const targetDistance = Math.abs(target - entry);
      profitAmount = qty * targetDistance;
      rrRatio = targetDistance / slDistance;
      targetPct = (targetDistance / entry) * 100;
    }

    // Brokerage (both legs — entry + exit)
    const entryBrok = calcBrokerage(inputs.tradeType, qty, entry);
    const exitBrok = sl > 0 ? calcBrokerage(inputs.tradeType, qty, sl) : entryBrok;
    const totalBrokerage = entryBrok.total + exitBrok.total;
    const netProfit = profitAmount - totalBrokerage;
    const netLoss = -(actualRisk + totalBrokerage);

    // Breakeven
    const breakevenMove = totalBrokerage / qty;
    const breakevenPrice =
      inputs.direction === "buy" ? entry + breakevenMove : entry - breakevenMove;

    // Consecutive losses to wipe 10% of capital
    const tenPctCapital = capital * 0.1;
    const lossTrades = actualRisk > 0 ? Math.floor(tenPctCapital / actualRisk) : 0;

    return {
      maxRiskAmount,
      qty,
      actualRisk,
      actualRiskPct,
      positionValue,
      capitalUsedPct,
      slDistance,
      slPct,
      profitAmount,
      netProfit,
      netLoss,
      rrRatio,
      targetPct,
      totalBrokerage,
      entryBrok,
      breakevenPrice,
      lossTrades,
    };
  }, [inputs]);

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
                <span className="text-white/50 text-sm hidden sm:block" style={{ fontFamily: "'Syne', sans-serif" }}>
                  Upstox Hub
                </span>
              </div>
            </Link>
            <span className="text-white/20">/</span>
            <span className="text-white font-bold text-sm" style={{ fontFamily: "'Syne', sans-serif" }}>
              Risk Calculator
            </span>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/20 text-xs transition-all duration-200"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
        </div>
      </header>

      <div className="container py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
            Scalping <span className="gradient-text">Risk Calculator</span>
          </h1>
          <p className="text-white/45 text-sm max-w-xl">
            Enter your trade details below to instantly calculate the ideal position size, stop-loss distance, risk/reward ratio, and net profit after brokerage.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1fr_420px] gap-6 items-start">
          {/* ── LEFT: Inputs ─────────────────────────────────────────────── */}
          <div className="space-y-5">
            {/* Section: Account */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-5" style={{ fontFamily: "'DM Mono', monospace" }}>
                01 — Account Settings
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <InputField
                  label="Total Capital"
                  value={inputs.capital}
                  onChange={set("capital")}
                  prefix="₹"
                  hint="Your total trading account balance"
                  min="1000"
                  step="1000"
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider flex items-center gap-1.5" style={{ fontFamily: "'DM Mono', monospace" }}>
                    Risk Per Trade
                    <RiskBadge pct={parseFloat(inputs.riskPct) || 0} />
                  </label>
                  <div className="flex items-center gap-0 rounded-xl border border-white/10 bg-white/4 focus-within:border-[oklch(0.78_0.18_195/0.5)] transition-all duration-200 overflow-hidden">
                    <input
                      type="number"
                      value={inputs.riskPct}
                      min="0.1"
                      max="10"
                      step="0.1"
                      onChange={(e) => set("riskPct")(e.target.value)}
                      className="flex-1 bg-transparent px-3 py-3 text-white text-sm outline-none min-w-0"
                      style={{ fontFamily: "'DM Mono', monospace" }}
                    />
                    <span className="px-3 text-white/40 text-xs border-l border-white/8 bg-white/3 h-full flex items-center py-3">%</span>
                  </div>
                  <p className="text-xs text-white/30">
                    Max loss:{" "}
                    <span className="text-[oklch(0.78_0.17_65)] font-mono">
                      ₹{inputs.capital && inputs.riskPct
                        ? ((parseFloat(inputs.capital) * parseFloat(inputs.riskPct)) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })
                        : "—"}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Section: Trade Setup */}
            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-5" style={{ fontFamily: "'DM Mono', monospace" }}>
                02 — Trade Setup
              </h2>

              {/* Trade Type + Direction */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>
                    Trade Type
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TRADE_TYPES.map((t) => (
                      <button
                        key={t.value}
                        onClick={() => set("tradeType")(t.value)}
                        className={`py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                          inputs.tradeType === t.value
                            ? "bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)]"
                            : "bg-white/5 text-white/50 hover:bg-white/8 hover:text-white/70 border border-white/8"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider" style={{ fontFamily: "'DM Mono', monospace" }}>
                    Direction
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => set("direction")("buy")}
                      className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all duration-200 ${
                        inputs.direction === "buy"
                          ? "bg-[oklch(0.78_0.18_195/0.2)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.4)]"
                          : "bg-white/5 text-white/50 border border-white/8 hover:bg-white/8"
                      }`}
                    >
                      <TrendingUp className="w-3.5 h-3.5" />
                      BUY
                    </button>
                    <button
                      onClick={() => set("direction")("sell")}
                      className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all duration-200 ${
                        inputs.direction === "sell"
                          ? "bg-[oklch(0.65_0.22_25/0.2)] text-[oklch(0.65_0.22_25)] border border-[oklch(0.65_0.22_25/0.4)]"
                          : "bg-white/5 text-white/50 border border-white/8 hover:bg-white/8"
                      }`}
                    >
                      <TrendingDown className="w-3.5 h-3.5" />
                      SELL
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <InputField
                  label="Entry Price"
                  value={inputs.entryPrice}
                  onChange={set("entryPrice")}
                  prefix="₹"
                  hint="Price at which you enter the trade"
                  step="0.05"
                />
                <InputField
                  label="Stop-Loss Price"
                  value={inputs.stopLossPrice}
                  onChange={set("stopLossPrice")}
                  prefix="₹"
                  hint={inputs.direction === "buy" ? "Must be below entry price" : "Must be above entry price"}
                  step="0.05"
                />
                <InputField
                  label="Target Price (Optional)"
                  value={inputs.targetPrice}
                  onChange={set("targetPrice")}
                  prefix="₹"
                  hint="Used to calculate R:R ratio and net profit"
                  step="0.05"
                />
                <InputField
                  label="Lot / Qty Size"
                  value={inputs.lotSize}
                  onChange={set("lotSize")}
                  hint="NIFTY=50, BANKNIFTY=15, Stocks=1"
                  min="1"
                  step="1"
                />
              </div>
            </div>

            {/* Quick Presets */}
            <div className="glass-card rounded-2xl p-5">
              <h2 className="text-xs font-bold text-white/40 uppercase tracking-widest mb-4" style={{ fontFamily: "'DM Mono', monospace" }}>
                Quick Presets
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: "NIFTY Options", lot: "50", type: "options" as TradeType },
                  { label: "BANKNIFTY Opt.", lot: "15", type: "options" as TradeType },
                  { label: "Intraday Stock", lot: "1", type: "intraday" as TradeType },
                  { label: "NIFTY Futures", lot: "50", type: "futures" as TradeType },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() =>
                      setInputs((prev) => ({
                        ...prev,
                        lotSize: p.lot,
                        tradeType: p.type,
                      }))
                    }
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/8 text-white/50 hover:text-white hover:border-[oklch(0.78_0.18_195/0.3)] hover:bg-[oklch(0.78_0.18_195/0.05)] text-xs transition-all duration-200 text-center"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT: Results (Sticky) ──────────────────────────────────── */}
          <div className="lg:sticky lg:top-20 space-y-4">
            {/* Main Results Card */}
            <div className={`rounded-2xl border transition-all duration-300 ${
              isValid
                ? "glass-card border-[oklch(0.78_0.18_195/0.25)]"
                : "bg-white/3 border-white/8"
            }`}>
              <div className="p-5 border-b border-white/5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white" style={{ fontFamily: "'Syne', sans-serif" }}>
                    Live Results
                  </h3>
                  {isValid && (
                    <span className="flex items-center gap-1.5 text-xs text-[oklch(0.78_0.18_195)]" style={{ fontFamily: "'DM Mono', monospace" }}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[oklch(0.78_0.18_195)] pulse-glow" />
                      CALCULATED
                    </span>
                  )}
                </div>
              </div>

              {!isValid ? (
                <div className="p-8 text-center">
                  <div className="w-12 h-12 rounded-full bg-white/5 border border-white/8 flex items-center justify-center mx-auto mb-3">
                    <Info className="w-5 h-5 text-white/25" />
                  </div>
                  <p className="text-white/30 text-sm">
                    Fill in Capital, Risk %, Entry Price, and Stop-Loss to see results.
                  </p>
                </div>
              ) : (
                <div className="p-5">
                  {/* Hero: Position Size */}
                  <div className="rounded-xl bg-[oklch(0.78_0.18_195/0.08)] border border-[oklch(0.78_0.18_195/0.2)] p-4 mb-4 text-center">
                    <p className="text-xs text-[oklch(0.78_0.18_195)] uppercase tracking-widest mb-1" style={{ fontFamily: "'DM Mono', monospace" }}>
                      Recommended Qty
                    </p>
                    <p className="text-5xl font-black text-white" style={{ fontFamily: "'Syne', sans-serif" }}>
                      {calc.qty.toLocaleString("en-IN")}
                    </p>
                    <p className="text-xs text-white/35 mt-1">
                      shares / units
                    </p>
                  </div>

                  {/* Key Metrics */}
                  <div className="space-y-0">
                    <ResultRow
                      label="Max Risk Amount"
                      value={`₹${calc.actualRisk.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                      color="text-[oklch(0.65_0.22_25)]"
                      sub={`${calc.actualRiskPct.toFixed(2)}% of capital`}
                    />
                    <ResultRow
                      label="Position Value"
                      value={`₹${calc.positionValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
                      sub={`${calc.capitalUsedPct.toFixed(1)}% of capital used`}
                    />
                    <ResultRow
                      label="SL Distance"
                      value={`₹${calc.slDistance.toFixed(2)}`}
                      sub={`${calc.slPct.toFixed(2)}% from entry`}
                    />
                    <ResultRow
                      label="Breakeven Price"
                      value={`₹${calc.breakevenPrice.toFixed(2)}`}
                      sub="After brokerage (entry + exit)"
                    />
                    {calc.rrRatio > 0 && (
                      <>
                        <ResultRow
                          label="Risk : Reward"
                          value={`1 : ${calc.rrRatio.toFixed(2)}`}
                          color={calc.rrRatio >= 2 ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.78_0.17_65)]"}
                        />
                        <ResultRow
                          label="Gross Profit"
                          value={`₹${calc.profitAmount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                          color="text-[oklch(0.78_0.18_195)]"
                        />
                        <ResultRow
                          label="Net Profit (after brok.)"
                          value={`₹${calc.netProfit.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                          color={calc.netProfit > 0 ? "text-[oklch(0.78_0.18_195)]" : "text-[oklch(0.65_0.22_25)]"}
                          large
                        />
                      </>
                    )}
                    <ResultRow
                      label="Net Loss (if SL hit)"
                      value={`₹${Math.abs(calc.netLoss).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
                      color="text-[oklch(0.65_0.22_25)]"
                      large
                    />
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
                      At this risk level, you can absorb{" "}
                      <span className="text-[oklch(0.78_0.17_65)] font-bold">{calc.lossTrades} consecutive losses</span>{" "}
                      before losing 10% of your capital.{" "}
                      {calc.lossTrades < 5 && (
                        <span className="text-[oklch(0.65_0.22_25)]">Consider reducing your risk % per trade.</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Brokerage Breakdown */}
            {isValid && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <button
                  onClick={() => setShowBrokerage(!showBrokerage)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-white/3 transition-colors duration-200"
                >
                  <span className="text-xs font-bold text-white/50 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>
                    Brokerage Breakdown (Upstox)
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[oklch(0.78_0.17_65)]" style={{ fontFamily: "'DM Mono', monospace" }}>
                      ₹{calc.totalBrokerage.toFixed(2)}
                    </span>
                    {showBrokerage ? (
                      <ChevronUp className="w-4 h-4 text-white/30" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-white/30" />
                    )}
                  </div>
                </button>
                {showBrokerage && (
                  <div className="px-4 pb-4 space-y-2 border-t border-white/5 pt-3">
                    {[
                      { label: "Brokerage (entry + exit)", val: (calc.entryBrok.brokerage + calc.entryBrok.brokerage).toFixed(2) },
                      { label: "STT", val: (calc.entryBrok.stt * 2).toFixed(2) },
                      { label: "Exchange Fees", val: (calc.entryBrok.exchangeFee * 2).toFixed(2) },
                      { label: "SEBI Charges", val: (calc.entryBrok.sebiCharges * 2).toFixed(4) },
                      { label: "Stamp Duty", val: (calc.entryBrok.stampDuty * 2).toFixed(2) },
                      { label: "GST (18%)", val: (calc.entryBrok.gst * 2).toFixed(2) },
                    ].map((r) => (
                      <div key={r.label} className="flex justify-between">
                        <span className="text-white/35 text-xs">{r.label}</span>
                        <span className="text-white/55 text-xs font-mono">₹{r.val}</span>
                      </div>
                    ))}
                    <div className="flex justify-between pt-2 border-t border-white/8">
                      <span className="text-white/60 text-xs font-semibold">Total (both legs)</span>
                      <span className="text-[oklch(0.78_0.17_65)] text-xs font-bold font-mono">₹{calc.totalBrokerage.toFixed(2)}</span>
                    </div>
                    <p className="text-white/20 text-xs mt-1">
                      Based on Upstox rates. Actual charges may vary slightly.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Disclaimer */}
            <p className="text-white/20 text-xs text-center leading-relaxed px-2">
              This calculator is for educational purposes only. Not financial advice. Always verify with your broker before trading.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
