import { useState, useEffect } from "react";
import { Joyride, STATUS, type Step, type EventData } from "react-joyride";

const TOUR_STORAGE_KEY = "scalpbot_tour_completed";

const steps: Step[] = [
  {
    target: '[data-tour="bot-slots"]',
    content: "These are your Bot Slots. Each slot runs independently on a different instrument. Start by clicking an inactive slot to configure it.",
    title: "🤖 Bot Slots",
    placement: "bottom",
    skipBeacon: true,
  },
  {
    target: '[data-tour="strategy-selector"]',
    content: "Choose which strategies to run. Category A (Proven) strategies are recommended for beginners. Toggle them ON/OFF in real-time — no restart needed.",
    title: "📊 Strategy Selector",
    placement: "top",
  },
  {
    target: '[data-tour="instrument-select"]',
    content: "Pick your trading instrument here — NIFTY 50, Bank NIFTY, or MCX commodities (Gold, Silver, Crude). Each bot slot can trade a different instrument.",
    title: "📈 Instrument Selection",
    placement: "bottom",
  },
  {
    target: '[data-tour="mode-toggle"]',
    content: "Start in PAPER mode to test without real money. Once confident, switch to LIVE. You can also use SHADOW mode to see signals without placing orders.",
    title: "🎯 Trading Mode",
    placement: "bottom",
  },
  {
    target: '[data-tour="start-button"]',
    content: "Hit START to launch the bot! It will scan for signals every 60 seconds using your selected strategies. Make sure your Upstox token is connected first (Settings page).",
    title: "🚀 Launch Bot",
    placement: "top",
  },
  {
    target: '[data-tour="pnl-section"]',
    content: "Track your daily P&L here in real-time. Realized = closed trades, Unrealized = open positions. The bot auto-manages exits with SL, target, and trailing stop.",
    title: "💰 P&L Tracking",
    placement: "bottom",
  },
];

export function DashboardTour() {
  const [run, setRun] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const completed = localStorage.getItem(TOUR_STORAGE_KEY);
    if (!completed) {
      const timer = setTimeout(() => setShowPrompt(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleEvent = (data: EventData) => {
    const { status } = data;
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      localStorage.setItem(TOUR_STORAGE_KEY, "true");
    }
  };

  const startTour = () => {
    setShowPrompt(false);
    setRun(true);
  };

  const dismissTour = () => {
    setShowPrompt(false);
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
  };

  return (
    <>
      {/* Tour prompt for first-time users */}
      {showPrompt && (
        <div className="fixed bottom-6 right-6 z-[9999] bg-gradient-to-br from-teal-900/95 to-slate-900/95 border border-teal-500/40 rounded-2xl p-5 shadow-2xl shadow-teal-500/10 max-w-sm animate-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-start gap-3">
            <span className="text-2xl">👋</span>
            <div>
              <h4 className="text-white font-semibold text-sm mb-1">Welcome to ScalpBot!</h4>
              <p className="text-white/60 text-xs mb-3">First time here? Take a quick tour to learn how the dashboard works.</p>
              <div className="flex gap-2">
                <button
                  onClick={startTour}
                  className="px-3 py-1.5 bg-teal-500 hover:bg-teal-400 text-black text-xs font-semibold rounded-lg transition-colors"
                >
                  Start Tour
                </button>
                <button
                  onClick={dismissTour}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white/70 text-xs rounded-lg transition-colors"
                >
                  Skip
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Joyride
        steps={steps}
        run={run}
        continuous
        scrollToFirstStep
        onEvent={handleEvent}
        locale={{
          back: "← Back",
          close: "Close",
          last: "Done!",
          next: "Next →",
          skip: "Skip tour",
        }}
        options={{
          primaryColor: "#14b8a6",
          backgroundColor: "#1e293b",
          textColor: "#e2e8f0",
          arrowColor: "#1e293b",
          overlayColor: "rgba(0, 0, 0, 0.7)",
          zIndex: 10000,
        }}
        styles={{
          tooltip: { borderRadius: 16, padding: "20px 24px" },
          buttonPrimary: { borderRadius: 8, fontSize: 13, fontWeight: 600, padding: "8px 16px" },
          buttonBack: { color: "#94a3b8", fontSize: 13 },
          buttonSkip: { color: "#64748b", fontSize: 12 },
        }}
      />
    </>
  );
}
