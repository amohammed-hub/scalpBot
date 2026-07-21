import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Zap, Target, TrendingUp, TrendingDown, Clock, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const SESSION_KEY = "scalpbot_session";
function getSessionToken(): string {
  let t = localStorage.getItem(SESSION_KEY);
  if (!t) { t = crypto.randomUUID(); localStorage.setItem(SESSION_KEY, t); }
  return t;
}

// IST time helpers
function getISTHour(): number {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  return ist.getUTCHours() + ist.getUTCMinutes() / 60;
}

function isExpiryWindow(): boolean {
  const h = getISTHour();
  return h >= 11 && h < 13.5; // 11 AM – 1:30 PM IST
}

/** Check if today (IST) matches the expiry date returned by the API */
function isTodayExpiry(expiryDateStr: string | null | undefined): boolean {
  if (!expiryDateStr) return false;
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + istOffset);
  const todayIST = ist.toISOString().slice(0, 10); // YYYY-MM-DD
  return todayIST === expiryDateStr;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function scoreColor(score: number): string {
  if (score >= 7) return "text-emerald-400";
  if (score >= 5) return "text-amber-400";
  return "text-slate-400";
}

function scoreBadge(score: number): string {
  if (score >= 7) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (score >= 5) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  return "bg-slate-700/50 text-slate-400 border-slate-600/30";
}

type Candidate = {
  instrumentKey: string;
  strikePrice: number;
  optionType: "CE" | "PE";
  premium: number;
  strikeDistancePct: number;
  delta: number;
  isHeroZeroRange: boolean;
  target5x: number;
  cut50pct: number;
  directionScore: number;
  directionBias: "BUY" | "SELL" | "NEUTRAL";
};

export default function HeroZeroScanner() {
  const sessionToken = getSessionToken();
  const [, navigate] = useLocation();

  // ── Mobile Auth Check ──────────────────────────────────────────────────────
  const meQuery = trpc.mobileAuth.me.useQuery(undefined, {
    staleTime: 5_000,
    retry: 2,
    retryDelay: 500,
  });
  useEffect(() => {
    if (meQuery.isFetched && !meQuery.data && !localStorage.getItem("scalpbot_auth_token")) {
      navigate("/login");
    }
  }, [meQuery.isFetched, meQuery.data, navigate]);

  const [underlying, setUnderlying] = useState<"NIFTY" | "BANKNIFTY" | "FINNIFTY">("NIFTY");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now());

  const inWindow = isExpiryWindow();

  const { data, isLoading, refetch } = trpc.heroZero.scanStrikes.useQuery(
    { sessionToken, underlying },
    { enabled: true, refetchInterval: autoRefresh && inWindow ? 60000 : false },
  );

  const isExpiry = isTodayExpiry(data?.expiryDate);

  const startSecondaryMutation = trpc.multiBots.startSecondary.useMutation({
    onSuccess: (res) => {
      toast.success(`Hero Zero bot started on slot ${res.slotToken.includes("slot2") ? 2 : 1}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRefresh = useCallback(() => {
    refetch();
    setLastRefresh(Date.now());
  }, [refetch]);

  const handleStartBot = (candidate: Candidate) => {
    if (!candidate.instrumentKey) {
      toast.error("No instrument key for this strike");
      return;
    }
    startSecondaryMutation.mutate({
      sessionToken,
      slot: 1,
      instrumentToken: candidate.instrumentKey,
      instrumentSymbol: `${underlying}${candidate.strikePrice}${candidate.optionType}`,
      instrumentLabel: `${underlying} ${candidate.strikePrice} ${candidate.optionType} (Hero Zero)`,
      mode: "paper",
      capital: 50000,
      riskPerTradePct: 1.0,
      maxTradesPerDay: 3,
      dailyLossLimitPct: 5.0,
      stopLossMultiplier: 0.5,
      targetMultiplier: 5.0,
      minConfidence: 55,
      scanIntervalSec: 30,
    });
  };

  const candidates = data?.candidates ?? [];
  const heroZeroCandidates = candidates.filter(c => c.isHeroZeroRange);
  const otherCandidates = candidates.filter(c => !c.isHeroZeroRange);

  // ── Auth Loading Gate (MUST be after all hooks) ────────────────────────────
  if (!meQuery.isFetched || (meQuery.isLoading && !localStorage.getItem("scalpbot_auth_token"))) {
    return (
      <div className="min-h-screen bg-[oklch(0.10_0.02_240)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-teal-500 rounded-xl flex items-center justify-center animate-pulse">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <p className="text-white/50 text-sm">Loading ScalpBot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[oklch(0.11_0.025_240)] text-white p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/dashboard")}
              className="border-slate-600 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white h-8 w-8 p-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <span className="text-2xl">🦸</span>
            <h1 className="text-2xl font-bold text-white">Hero Zero Scanner</h1>
            <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs">
              OTM Options
            </Badge>
          </div>
          <p className="text-slate-400 text-sm">
            Scan for ₹2–50 premium OTM options with 5× upside potential
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={underlying} onValueChange={(v) => setUnderlying(v as typeof underlying)}>
            <SelectTrigger className="w-36 bg-slate-800/60 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              <SelectItem value="NIFTY">NIFTY</SelectItem>
              <SelectItem value="BANKNIFTY">BANKNIFTY</SelectItem>
              <SelectItem value="FINNIFTY">FINNIFTY</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(v => !v)}
            className={`border-slate-600 text-sm ${autoRefresh ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300" : "bg-slate-800/60 text-slate-300"}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${autoRefresh ? "animate-spin" : ""}`} />
            {autoRefresh ? "Auto ON" : "Auto OFF"}
          </Button>
          <Button
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`} />
            Scan
          </Button>
        </div>
      </div>

      {/* Status banners */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <div className={`rounded-lg p-3 border flex items-center gap-3 ${isExpiry ? "bg-purple-500/10 border-purple-500/30" : "bg-slate-800/40 border-slate-700/50"}`}>
          <Clock className={`w-5 h-5 ${isExpiry ? "text-purple-400" : "text-slate-500"}`} />
          <div>
            <div className="text-xs text-slate-400">Expiry Day</div>
            <div className={`text-sm font-semibold ${isExpiry ? "text-purple-300" : "text-slate-500"}`}>
              {isExpiry ? "✅ Active" : "❌ Not Today"}
            </div>
          </div>
        </div>
        <div className={`rounded-lg p-3 border flex items-center gap-3 ${inWindow ? "bg-emerald-500/10 border-emerald-500/30" : "bg-slate-800/40 border-slate-700/50"}`}>
          <Zap className={`w-5 h-5 ${inWindow ? "text-emerald-400" : "text-slate-500"}`} />
          <div>
            <div className="text-xs text-slate-400">Trading Window</div>
            <div className={`text-sm font-semibold ${inWindow ? "text-emerald-300" : "text-slate-500"}`}>
              {inWindow ? "✅ 11AM–1:30PM" : "⏰ 11AM–1:30PM IST"}
            </div>
          </div>
        </div>
        <div className="rounded-lg p-3 border bg-slate-800/40 border-slate-700/50 flex items-center gap-3">
          <Target className="w-5 h-5 text-amber-400" />
          <div>
            <div className="text-xs text-slate-400">Underlying Price</div>
            <div className="text-sm font-semibold text-amber-300">
              {data?.underlyingPrice ? `₹${data.underlyingPrice.toLocaleString("en-IN")}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Expiry info */}
      {data?.expiryDate && (
        <div className="mb-4 text-xs text-slate-400 flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" />
          <span>Expiry: <span className="text-white font-medium">{data.expiryDate}</span></span>
          <span className="mx-1">·</span>
          <span>Last scan: <span className="text-white">{formatTime(lastRefresh)}</span></span>
          <span className="mx-1">·</span>
          <span className="text-purple-300">{heroZeroCandidates.length} Hero Zero candidates found</span>
        </div>
      )}

      {/* Error state */}
      {data?.error && (
        <div className="mb-4 rounded-lg p-3 bg-red-500/10 border border-red-500/30 flex items-center gap-2 text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {data.error}
        </div>
      )}

      {/* Hero Zero candidates table */}
      {heroZeroCandidates.length > 0 && (
        <Card className="bg-slate-900/60 border-purple-500/20 mb-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="text-lg">🦸</span>
              <span className="text-purple-300">Hero Zero Range (₹2–50 Premium)</span>
              <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs ml-auto">
                {heroZeroCandidates.length} found
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left px-4 py-2 text-slate-400 font-medium text-xs">Strike</th>
                    <th className="text-left px-4 py-2 text-slate-400 font-medium text-xs">Type</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium text-xs">Premium</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium text-xs">OTM%</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium text-xs">5× Target</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium text-xs">50% Cut</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium text-xs">Score</th>
                    <th className="text-right px-4 py-2 text-slate-400 font-medium text-xs">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {heroZeroCandidates.map((c, i) => (
                    <tr
                      key={`${c.strikePrice}-${c.optionType}`}
                      className={`border-b border-slate-800/50 cursor-pointer transition-colors ${selectedCandidate?.instrumentKey === c.instrumentKey ? "bg-purple-500/10" : "hover:bg-slate-800/40"}`}
                      onClick={() => setSelectedCandidate(c)}
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-white">{c.strikePrice.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-3">
                        <Badge className={c.optionType === "CE" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}>
                          {c.optionType === "CE" ? <TrendingUp className="w-3 h-3 mr-1 inline" /> : <TrendingDown className="w-3 h-3 mr-1 inline" />}
                          {c.optionType}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-amber-300">₹{c.premium.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{c.strikeDistancePct.toFixed(2)}%</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-400 font-semibold">₹{c.target5x.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-400">₹{c.cut50pct.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge className={`${scoreBadge(c.directionScore)} text-xs`}>{c.directionScore}/8</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-7 px-2"
                          onClick={(e) => { e.stopPropagation(); handleStartBot(c); }}
                          disabled={startSecondaryMutation.isPending}
                        >
                          <Zap className="w-3 h-3 mr-1" />
                          Start Bot
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selected candidate detail */}
      {selectedCandidate && (
        <Card className="bg-slate-900/60 border-purple-500/30 mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-purple-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Selected: {underlying} {selectedCandidate.strikePrice} {selectedCandidate.optionType}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Entry Premium", value: `₹${selectedCandidate.premium.toFixed(1)}`, color: "text-amber-300" },
                { label: "2.5× Book 50%", value: `₹${(selectedCandidate.premium * 2.5).toFixed(1)}`, color: "text-blue-300" },
                { label: "3.5× Book 25%", value: `₹${(selectedCandidate.premium * 3.5).toFixed(1)}`, color: "text-indigo-300" },
                { label: "5× Full Target", value: `₹${selectedCandidate.target5x.toFixed(1)}`, color: "text-emerald-400 font-bold" },
                { label: "50% Cut", value: `₹${selectedCandidate.cut50pct.toFixed(1)}`, color: "text-red-400" },
                { label: "OTM Distance", value: `${selectedCandidate.strikeDistancePct.toFixed(2)}%`, color: "text-slate-300" },
                { label: "Delta", value: selectedCandidate.delta.toFixed(3), color: "text-slate-300" },
                { label: "Direction Score", value: `${selectedCandidate.directionScore}/8`, color: scoreColor(selectedCandidate.directionScore) },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/40">
                  <div className="text-xs text-slate-400 mb-1">{label}</div>
                  <div className={`text-sm font-semibold font-mono ${color}`}>{value}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                className="bg-purple-600 hover:bg-purple-700 text-white"
                onClick={() => handleStartBot(selectedCandidate)}
                disabled={startSecondaryMutation.isPending}
              >
                <Zap className="w-4 h-4 mr-2" />
                Start Hero Zero Bot (Slot 1)
              </Button>
              <Button
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-800"
                onClick={() => setSelectedCandidate(null)}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Other candidates (outside ₹2–50 range) */}
      {otherCandidates.length > 0 && (
        <Card className="bg-slate-900/60 border-slate-700/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-slate-400 flex items-center gap-2">
              Other OTM Candidates (outside ₹2–50 range)
              <Badge className="bg-slate-700/50 text-slate-400 border-slate-600/30 text-xs ml-auto">
                {otherCandidates.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left px-4 py-2 text-slate-500 font-medium text-xs">Strike</th>
                    <th className="text-left px-4 py-2 text-slate-500 font-medium text-xs">Type</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-medium text-xs">Premium</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-medium text-xs">OTM%</th>
                    <th className="text-right px-4 py-2 text-slate-500 font-medium text-xs">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {otherCandidates.map((c) => (
                    <tr key={`${c.strikePrice}-${c.optionType}`} className="border-b border-slate-800/30 opacity-60">
                      <td className="px-4 py-2 font-mono text-slate-300">{c.strikePrice.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2">
                        <Badge className={c.optionType === "CE" ? "bg-emerald-500/10 text-emerald-600 border-emerald-700/30" : "bg-red-500/10 text-red-600 border-red-700/30"}>
                          {c.optionType}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-slate-400">₹{c.premium.toFixed(1)}</td>
                      <td className="px-4 py-2 text-right text-slate-500">{c.strikeDistancePct.toFixed(2)}%</td>
                      <td className="px-4 py-2 text-right">
                        <Badge className={`${scoreBadge(c.directionScore)} text-xs`}>{c.directionScore}/8</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && candidates.length === 0 && !data?.error && (
        <div className="text-center py-16 text-slate-500">
          <span className="text-5xl block mb-4">🦸</span>
          <p className="text-lg font-medium text-slate-400 mb-2">No candidates found yet</p>
          <p className="text-sm">Click <strong>Scan</strong> to search for OTM options in the ₹2–50 premium range.</p>
          {!isExpiry && <p className="text-xs mt-2 text-amber-400">Best results on expiry day (Thu for NIFTY, Wed for BANKNIFTY)</p>}
        </div>
      )}

      {/* Strategy guide */}
      <div className="mt-6 rounded-lg p-4 bg-slate-800/30 border border-slate-700/30">
        <h3 className="text-sm font-semibold text-purple-300 mb-2 flex items-center gap-2">
          <span>📖</span> Hero Zero Strategy Rules
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-400">
          <div className="space-y-1">
            <p>• <span className="text-white">Entry:</span> ₹2–50 premium, 1–5% OTM, expiry day 11AM–1:30PM</p>
            <p>• <span className="text-white">Target:</span> 5× premium (500% gain)</p>
            <p>• <span className="text-white">Cut:</span> 50% loss — exit immediately, no averaging</p>
          </div>
          <div className="space-y-1">
            <p>• <span className="text-white">Book 50%</span> at 2.5× premium, move SL to entry</p>
            <p>• <span className="text-white">Book 25%</span> at 3.5× premium, trail rest to 5×</p>
            <p>• <span className="text-white">Score ≥7</span> = strong candidate, ≥5 = acceptable</p>
          </div>
        </div>
      </div>
    </div>
  );
}
