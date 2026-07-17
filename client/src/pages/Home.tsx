import { Button } from "@/components/ui/button";
import { useLocation, Link } from "wouter";
import { Bot, TrendingUp, Shield, Zap, BarChart2, Check, Crown, Loader2 } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Home() {
  const [, navigate] = useLocation();
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [showTrialStarting, setShowTrialStarting] = useState(false);

  // ── Auto-redirect logged-in users to dashboard ──────────────────────────
  useEffect(() => {
    const token = localStorage.getItem("scalpbot_auth_token");
    if (token) {
      navigate("/dashboard");
    }
  }, [navigate]);

  // Get session token for subscription
  const getSessionToken = useCallback(() => {
    let token = localStorage.getItem("scalpbot_session");
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem("scalpbot_session", token);
    }
    return token;
  }, []);

  const createOrderMutation = trpc.subscription.createOrder.useMutation({
    onSuccess: (data) => {
      // Open Razorpay checkout
      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "ScalpBot",
        description: `${data.planLabel} Subscription`,
        order_id: data.orderId,
        handler: async (response: any) => {
          // Verify payment on server
          try {
            await verifyPaymentMutation.mutateAsync({
              sessionToken: getSessionToken(),
              plan: checkingOut as any,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            toast.success("Payment successful! Subscription activated.");
            navigate("/dashboard");
          } catch (e: any) {
            toast.error(`Payment verification failed: ${e.message}`);
          }
          setCheckingOut(null);
        },
        modal: {
          ondismiss: () => setCheckingOut(null),
        },
        theme: { color: "#14b8a6" },
      };
      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    },
    onError: (e) => {
      toast.error(e.message);
      setCheckingOut(null);
    },
  });

  const verifyPaymentMutation = trpc.subscription.verifyPayment.useMutation();

  // Start trial mutation for the landing page CTA
  const startTrialMutation = trpc.subscription.startTrial.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("2-day free trial activated! Redirecting to dashboard...");
        setTimeout(() => navigate("/dashboard"), 800);
      } else {
        toast.error(data.error || "Could not start trial. You may have already used it.");
        setShowTrialStarting(false);
      }
    },
    onError: (e) => {
      toast.error(e.message);
      setShowTrialStarting(false);
    },
  });

  const handleStartTrial = () => {
    // Check if user is logged in first
    const authToken = localStorage.getItem("scalpbot_auth_token");
    if (!authToken) {
      // Not logged in — send to login with a return intent
      toast.info("Sign in first to start your free trial");
      navigate("/login?intent=trial");
      return;
    }
    setShowTrialStarting(true);
    startTrialMutation.mutate({ sessionToken: getSessionToken() });
  };

  const handleSubscribe = (plan: "monthly" | "quarterly" | "half_yearly" | "yearly") => {
    // Check if user is logged in first
    const authToken = localStorage.getItem("scalpbot_auth_token");
    if (!authToken) {
      toast.info("Sign in first to subscribe");
      navigate("/login?intent=subscribe");
      return;
    }
    setCheckingOut(plan);
    createOrderMutation.mutate({
      sessionToken: getSessionToken(),
      plan,
    });
  };

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
          <button onClick={() => {
            const el = document.getElementById("pricing");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }} className="hidden sm:inline-flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-white/70 hover:text-white transition-colors">
            Pricing
          </button>
          <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => navigate("/login")}>
            Sign In
          </Button>
          <Button className="bg-teal-500 hover:bg-teal-600 text-white" onClick={handleStartTrial} disabled={showTrialStarting}>
            {showTrialStarting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            Free Trial
          </Button>
        </div>
      </nav>

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
          Connect your Upstox account, configure your risk settings, and let the AI-powered scalping bot automatically detect signals and place orders on NSE and MCX markets.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" className="bg-teal-500 hover:bg-teal-600 text-white px-8 py-6 text-lg" onClick={handleStartTrial} disabled={showTrialStarting}>
            {showTrialStarting ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Zap className="w-5 h-5 mr-2" />}
            Start 2-Day Free Trial
          </Button>
          <Button size="lg" variant="outline" className="border-white/20 text-white hover:bg-white/10 px-8 py-6 text-lg" onClick={() => {
            const el = document.getElementById("pricing");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }}>
            <Crown className="w-5 h-5 mr-2" />
            View Plans & Pricing
          </Button>
        </div>
        <p className="text-white/40 text-sm mt-4">No credit card required. Paper trading on NSE included in trial.</p>
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

        {/* Pricing */}
        <div className="mt-20 text-center" id="pricing">
          <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/30 rounded-full px-4 py-1.5 text-purple-400 text-sm mb-4">
            <Crown className="w-4 h-4" />
            Simple Pricing
          </div>
          <h2 className="text-3xl font-bold text-white mb-3">Choose Your Plan</h2>
          <p className="text-white/50 mb-10">Start with a 2-day free trial. Full access to all features.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Monthly */}
            <div className="relative bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-teal-500/40 transition-colors">
              <h3 className="text-lg font-semibold text-white mb-1">Monthly</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-3xl font-bold text-white">₹9,999</span>
                <span className="text-white/40 text-sm">/month</span>
              </div>
              <ul className="space-y-2.5 text-left mb-6">
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Live + Paper Trading</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> NSE + MCX Markets</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> 3 Parallel Bots</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Hero Zero Scanner</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> P&L Analytics</li>
              </ul>
              <Button className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/20" onClick={() => handleSubscribe("monthly")} disabled={!!checkingOut}>
                {checkingOut === "monthly" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
              </Button>
            </div>

            {/* 3 Months */}
            <div className="relative bg-white/5 border border-teal-500/50 rounded-2xl p-6 ring-1 ring-teal-500/20">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-teal-500 text-white text-xs font-bold px-3 py-1 rounded-full">POPULAR</div>
              <h3 className="text-lg font-semibold text-white mb-1">3 Months</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold text-white">₹24,999</span>
              </div>
              <p className="text-teal-400 text-xs mb-4">Save 17% — ₹8,333/month</p>
              <ul className="space-y-2.5 text-left mb-6">
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Everything in Monthly</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Telegram Alerts</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Carry Forward Mode</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Backtest Engine</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Priority Support</li>
              </ul>
              <Button className="w-full bg-teal-500 hover:bg-teal-600 text-white" onClick={() => handleSubscribe("quarterly")} disabled={!!checkingOut}>
                {checkingOut === "quarterly" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
              </Button>
            </div>

            {/* 6 Months */}
            <div className="relative bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-teal-500/40 transition-colors">
              <h3 className="text-lg font-semibold text-white mb-1">6 Months</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold text-white">₹44,999</span>
              </div>
              <p className="text-teal-400 text-xs mb-4">Save 25% — ₹7,500/month</p>
              <ul className="space-y-2.5 text-left mb-6">
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Everything in 3 Months</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Custom Strategy Builder</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Multi-Account Support</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Advanced Analytics</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Dedicated Onboarding</li>
              </ul>
              <Button className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/20" onClick={() => handleSubscribe("half_yearly")} disabled={!!checkingOut}>
                {checkingOut === "half_yearly" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
              </Button>
            </div>

            {/* Yearly */}
            <div className="relative bg-white/5 border border-white/10 rounded-2xl p-6 hover:border-teal-500/40 transition-colors">
              <h3 className="text-lg font-semibold text-white mb-1">1 Year</h3>
              <div className="flex items-baseline gap-1 mb-1">
                <span className="text-3xl font-bold text-white">₹79,999</span>
              </div>
              <p className="text-teal-400 text-xs mb-4">Save 33% — ₹6,667/month</p>
              <ul className="space-y-2.5 text-left mb-6">
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Everything in 6 Months</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Lifetime Updates</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> 1-on-1 Strategy Call</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Early Access Features</li>
                <li className="flex items-center gap-2 text-sm text-white/70"><Check className="w-4 h-4 text-teal-400 shrink-0" /> Best Value</li>
              </ul>
              <Button className="w-full bg-white/10 hover:bg-white/20 text-white border border-white/20" onClick={() => handleSubscribe("yearly")} disabled={!!checkingOut}>
                {checkingOut === "yearly" ? <Loader2 className="w-4 h-4 animate-spin" /> : "Subscribe"}
              </Button>
            </div>
          </div>

          <p className="text-white/40 text-sm mt-6">All plans include a 2-day free trial. No refunds on cancellation — access continues until the end of your billing period.</p>
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
