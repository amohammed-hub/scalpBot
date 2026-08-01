import React, { useState, useRef } from "react";
import { Shield, Zap, TrendingUp, Cpu, Lock, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc"; // 👈 Added this missing import

export default function Login() {
  const [mobile, setMobile] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const loginFormRef = useRef<HTMLDivElement>(null);

  const scrollToLogin = () => {
    loginFormRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if (mobile.length !== 10) {
      alert("Please enter a valid 10-digit mobile number.");
      return;
    }

    // Admin number bypass
    if (mobile === "8686742267") {
      setOtpSent(true);
      return;
    }

    // Non-admin numbers get routed to pricing
    alert("Account not found! Please select a subscription plan below to sign up.");
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: "smooth"
    });
  };

  const verifyOtpMutation = trpc.mobileAuth.verifyOtp.useMutation();

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // Requests the cookie from the backend
      const result = await verifyOtpMutation.mutateAsync({
        mobile: mobile,
        code: otp,
        sessionToken: localStorage.getItem("scalpbot_session_token") || "admin_session",
      });

      if (result.success) {
        window.location.assign("/dashboard");
      } else {
        alert(result.message || "Invalid OTP code.");
      }
    } catch (err: any) {
      alert(err?.message || "Verification failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100 font-sans selection:bg-teal-500 selection:text-white">
      {/* ── Top Navigation ── */}
      <nav className="border-b border-slate-800/80 bg-[#0B0E14]/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
            <Shield className="w-6 h-6" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-white">Scalp<span className="text-teal-400">Bot</span></span>
        </a>
        <button 
          onClick={scrollToLogin}
          className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-medium text-sm transition-all shadow-lg shadow-teal-900/20"
        >
          Login
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
              <h2 className="text-2xl font-bold text-white">Log In to ScalpBot</h2>
              <p className="text-xs text-slate-400">Enter your registered mobile number to continue</p>
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
                    type="password"
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
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-8 px-6 text-center text-xs text-slate-500">
        <p>© 2026 ScalpBot. All rights reserved. Automated trading involves financial risk.</p>
      </footer>
    </div>
  );
}
