import React, { useState, useRef } from "react";
import { Shield, Zap, TrendingUp, Cpu, Lock, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";

export default function Login() {
  const [mobile, setMobile] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const loginFormRef = useRef<HTMLDivElement>(null);

  const scrollToLogin = () => {
    loginFormRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile.length !== 10) return;

    // ── Admin Bypass (Skip backend check for your admin number) ──
    // Replace "9999999999" with your actual 10-digit mobile number
    if (mobile === "9999999999") {
      setOtpSent(true);
      return;
    }

    // ── Real User Logic ──
    try {
      // 1. Check if the user exists in your database
      /* 
      const response = await fetch("/api/check-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: mobile })
      });
      const data = await response.json();
      */

      // TEMPORARY MOCK LOGIC (Until backend is wired up)
      // We will pretend the API responded with 'false' (user does not exist)
      const data = { exists: false }; 

      if (data.exists) {
        // User is a paying subscriber. Backend sent the Twilio OTP.
        setOtpSent(true);
      } else {
        // User is NOT in the database. Force them to buy a plan.
        alert("Account not found! Please select a subscription plan below to sign up.");
        
        // Automatically scroll down to the pricing section
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth"
        });
      }
    } catch (error) {
      console.error("Failed to check user status", error);
      alert("Something went wrong checking your account. Please try again.");
    }
  };
  const handleVerifyOtp = (e: React.FormEvent) => {
    e.preventDefault();
    
    // 1. Set a dummy token so your Protected Routes let you in
    localStorage.setItem("token", "test_dev_token");
    localStorage.setItem("isAuthenticated", "true");
    
    // 2. Now route to the dashboard
    navigate("/dashboard");
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100 font-sans selection:bg-teal-500 selection:text-white">
      {/* ── Top Navigation ── */}
      <nav className="border-b border-slate-800/80 bg-[#0B0E14]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
            <Shield className="w-6 h-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-white">Scalp<span className="text-teal-400">Bot</span></span>
        </div>
        <button 
          onClick={scrollToLogin}
          className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-medium text-sm transition-all shadow-lg shadow-teal-900/20"
        >
          Login / Signup
        </button>
      </nav>

      {/* ── Hero & Login Section ── */}
      <section className="max-w-7xl mx-auto px-6 py-16 grid lg:grid-cols-12 gap-12 items-center">
        {/* Left Side: Pitch */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-xs font-semibold tracking-wide uppercase">
            <Sparkles className="w-3.5 h-3.5" /> Next-Gen Options Algo Engine
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Institutional-Grade <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400">
              Automated Options Trading
            </span>
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed max-w-2xl">
            ScalpBot monitors NSE & MCX markets in real-time, executing high-conviction momentum, breakout, and mean-reversion trades with multi-layer risk barriers and instant Upstox integration.
          </p>

          <div className="grid sm:grid-cols-2 gap-4 pt-4">
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <Zap className="w-5 h-5 text-teal-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white">Regime-Aware Execution</p>
                <p className="text-xs text-slate-400">Auto-detects trending vs choppy market regimes.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <TrendingUp className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-white">Smart Risk Management</p>
                <p className="text-xs text-slate-400">Strict portfolio drawdown halts & SL guards.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side: Login Form Card */}
        <div ref={loginFormRef} className="lg:col-span-5">
          <div className="bg-[#121824] border border-slate-800 rounded-3xl p-8 shadow-2xl shadow-teal-950/20 relative">
            <div className="text-center space-y-2 mb-6">
              <div className="inline-flex p-3 rounded-2xl bg-teal-500/10 text-teal-400 mb-1">
                <Shield className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-white">Get Started with ScalpBot</h2>
              <p className="text-xs text-slate-400">Enter your mobile number to log in or create an account</p>
            </div>

            {!otpSent ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Mobile Number</label>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400 border-r border-slate-700 pr-2.5">+91</span>
                    <input
                      type="tel"
                      maxLength={10}
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
                      placeholder="Enter 10-digit mobile number"
                      className="w-full pl-16 pr-4 py-3.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 text-sm font-medium transition-all"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={mobile.length !== 10}
                  className="w-full py-3.5 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-teal-950/40"
                >
                  Send OTP <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Enter 6-Digit OTP</label>
                  <input
                    type="text"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="• • • • • •"
                    className="w-full px-4 py-3.5 rounded-xl bg-slate-900/90 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-teal-500 text-center tracking-widest text-lg font-mono transition-all"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={otp.length !== 6}
                  className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-sm transition-all shadow-lg shadow-emerald-950/40"
                >
                  Verify & Access Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setOtpSent(false)}
                  className="w-full text-xs text-slate-400 hover:text-slate-200 transition-colors text-center block pt-2"
                >
                  Change mobile number
                </button>
              </form>
            )}

            <div className="mt-6 pt-6 border-t border-slate-800/80 text-center">
              <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> 256-Bit Encrypted. Your data is never shared.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Details / What It Is Section ── */}
      <section className="bg-slate-900/40 border-y border-slate-800/60 py-20 px-6">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-3 max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-white">Why Automated Options Scalping Works</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Eliminate emotional trading, late entries, and missed exits. ScalpBot runs directly on high-speed servers with direct broker integration.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-[#121824] border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 mb-2">
                <Cpu className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Multi-Strategy Engine</h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Executes ORB, Supertrend, Renko, VWAP Deviation, and Opening Burst setups across Nifty, BankNifty, Sensex, and MCX Crude.
              </p>
            </div>

            <div className="bg-[#121824] border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-2">
                <Shield className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Automated Risk Safeguards</h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Includes per-trade stop-loss, trailing stops, daily maximum loss limits, and consecutive loss cooldowns.
              </p>
            </div>

            <div className="bg-[#121824] border border-slate-800 rounded-2xl p-6 space-y-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-2">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Instant Upstox Integration</h3>
              <p className="text-slate-400 text-xs leading-relaxed">
                Connect your Upstox trading account seamlessly with zero-latency order placement directly to exchange servers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Subscription Plans Section ── */}
      <section className="py-20 px-6 max-w-7xl mx-auto space-y-12">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            Simple & Transparent Pricing
          </div>
          <h2 className="text-3xl font-bold text-white">Select Your ScalpBot Subscription</h2>
          <p className="text-slate-400 text-sm">
            Choose the plan that fits your trading capital and goals. Lock in discounted launch pricing today.
          </p>
        </div>

        {/* Pricing Cards Grid */}
        <div className="grid lg:grid-cols-3 gap-8 items-stretch">
          
          {/* Plan 1: 1 Month */}
          <div className="bg-[#121824] border border-slate-800 rounded-3xl p-8 flex flex-col justify-between space-y-6 relative hover:border-slate-700 transition-all">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">1 Month Plan</h3>
                <span className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 text-xs font-medium">Monthly</span>
              </div>
              <p className="text-slate-400 text-xs">Ideal for testing automated scalping strategies.</p>
              
              <div className="pt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-500 text-lg line-through font-semibold">₹14,999</span>
                  <span className="text-4xl font-extrabold text-white">₹9,999</span>
                  <span className="text-xs text-slate-400">/ month</span>
                </div>
                <span className="inline-block mt-2 px-2.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold">
                  Save 33% Launch Discount
                </span>
              </div>

              <ul className="space-y-3 pt-4 border-t border-slate-800/80 text-xs text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Access to 4 Bot Slots</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> All Strategies (ORB, Trikal, Renko)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> NSE Index & MCX Commodity Options</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Real-time Telegram Alerts</li>
              </ul>
            </div>

            <button
              onClick={scrollToLogin}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-all"
            >
              Get Started
            </button>
          </div>

          {/* Plan 2: 3 Months (Most Popular) */}
          <div className="bg-[#121824] border-2 border-teal-500 rounded-3xl p-8 flex flex-col justify-between space-y-6 relative shadow-2xl shadow-teal-950/40">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-teal-500 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg">
              Most Popular
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">3 Months Plan</h3>
                <span className="px-2.5 py-1 rounded-md bg-teal-500/20 text-teal-300 text-xs font-medium">Quarterly</span>
              </div>
              <p className="text-slate-400 text-xs">Best balance for consistent quarterly profitability.</p>

              <div className="pt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-500 text-lg line-through font-semibold">₹44,997</span>
                  <span className="text-4xl font-extrabold text-white">₹24,999</span>
                  <span className="text-xs text-slate-400">/ 3 months</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="px-2.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold">
                    Save 44% (Effective ₹8,333/mo)
                  </span>
                </div>
              </div>

              <ul className="space-y-3 pt-4 border-t border-slate-800/80 text-xs text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Everything in Monthly Plan</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Priority Upstox Order Routing</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Advanced Regime Switcher Controls</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> VIP Community Support</li>
              </ul>
            </div>

            <button
              onClick={scrollToLogin}
              className="w-full py-3.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs transition-all shadow-lg shadow-teal-500/20"
            >
              Get Started (Save 44%)
            </button>
          </div>

          {/* Plan 3: 1 Year (Best Value) */}
          <div className="bg-[#121824] border border-slate-800 rounded-3xl p-8 flex flex-col justify-between space-y-6 relative hover:border-slate-700 transition-all">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">1 Year Plan</h3>
                <span className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 text-xs font-medium">Annual</span>
              </div>
              <p className="text-slate-400 text-xs">Maximum savings for committed automated traders.</p>

              <div className="pt-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-slate-500 text-lg line-through font-semibold">₹1,79,988</span>
                  <span className="text-4xl font-extrabold text-white">₹79,999</span>
                  <span className="text-xs text-slate-400">/ year</span>
                </div>
                <span className="inline-block mt-2 px-2.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold">
                  Save 55% (Effective ₹6,666/mo)
                </span>
              </div>

              <ul className="space-y-3 pt-4 border-t border-slate-800/80 text-xs text-slate-300">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Everything in Quarterly Plan</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Max Risk Allocation Cap Customization</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> 1-on-1 Onboarding Assistance</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0" /> Locked Price for Lifetime Renewals</li>
              </ul>
            </div>

            <button
              onClick={scrollToLogin}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-all"
            >
              Get Started
            </button>
          </div>

        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-8 px-6 text-center text-xs text-slate-500">
        <p>© 2026 ScalpBot. All rights reserved. Automated trading involves financial risk.</p>
      </footer>
    </div>
  );
}
