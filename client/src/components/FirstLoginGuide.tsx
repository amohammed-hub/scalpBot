import { useState } from "react";
import { Bot, Zap, Shield, Square, DollarSign, Activity, ChevronRight, X } from "lucide-react";

const LS_GUIDE_SEEN = "scalpbot_guide_seen";

interface Step {
  icon: React.ReactNode;
  title: string;
  description: string;
}

const GUIDE_STEPS: Step[] = [
  {
    icon: <Bot className="w-6 h-6 text-teal-400" />,
    title: "Bot Slots",
    description: "Each slot runs an independent trading bot on a different instrument. Start a bot by selecting an instrument and clicking the Play button.",
  },
  {
    icon: <Zap className="w-6 h-6 text-amber-400" />,
    title: "Paper vs Live Mode",
    description: "Paper Mode simulates trades with no real money — perfect for testing. Live Mode places real orders via your Upstox account. Always test in Paper first!",
  },
  {
    icon: <Shield className="w-6 h-6 text-red-400" />,
    title: "Kill Switch",
    description: "Emergency button that stops ALL bots and closes ALL open positions at market price. Use only in emergencies — there's no undo.",
  },
  {
    icon: <Square className="w-6 h-6 text-orange-400" />,
    title: "Stop Button",
    description: "Stops only that specific bot slot. Open positions stay open until SL/target hits or you manually close them.",
  },
  {
    icon: <DollarSign className="w-6 h-6 text-green-400" />,
    title: "Capital Field",
    description: "Set the maximum capital for each bot slot (₹5,000 – ₹50,00,000). Position sizing is calculated as a percentage of this amount.",
  },
  {
    icon: <Activity className="w-6 h-6 text-purple-400" />,
    title: "Signals & Strategies",
    description: "The multi-layer signal engine (Pattern, Trend, Momentum, MACD_BB, VWAP) votes independently. A trade opens only when enough layers agree on direction.",
  },
];

export function FirstLoginGuide() {
  const [visible, setVisible] = useState(() => !localStorage.getItem(LS_GUIDE_SEEN));
  const [step, setStep] = useState(0);

  if (!visible) return null;

  const handleDismiss = () => {
    localStorage.setItem(LS_GUIDE_SEEN, "1");
    setVisible(false);
  };

  const handleNext = () => {
    if (step < GUIDE_STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleDismiss();
    }
  };

  const handleSkip = () => {
    handleDismiss();
  };

  const current = GUIDE_STEPS[step];
  const isLast = step === GUIDE_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-[oklch(0.13_0.02_240)] border border-teal-500/30 rounded-2xl p-6 shadow-2xl shadow-teal-500/10 relative overflow-hidden">
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute top-4 right-4 text-white/40 hover:text-white/80 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-1.5 mb-6">
          {GUIDE_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step ? "w-6 bg-teal-400" : i < step ? "w-1.5 bg-teal-400/50" : "w-1.5 bg-white/20"
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
            {current.icon}
          </div>
        </div>

        {/* Content */}
        <h3 className="text-xl font-bold text-white text-center mb-2">{current.title}</h3>
        <p className="text-white/60 text-sm text-center leading-relaxed mb-6 min-h-[48px]">
          {current.description}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSkip}
            className="flex-1 py-2.5 text-white/50 hover:text-white/80 text-sm font-medium transition-colors"
          >
            Skip Guide
          </button>
          <button
            onClick={handleNext}
            className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-400 text-black font-bold rounded-lg transition-all active:scale-[0.97] flex items-center justify-center gap-1.5"
          >
            {isLast ? "Got it!" : "Next"}
            {!isLast && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* Step counter */}
        <p className="text-center text-white/30 text-xs mt-3">
          {step + 1} of {GUIDE_STEPS.length}
        </p>
      </div>
    </div>
  );
}
