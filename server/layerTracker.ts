/**
 * Strategy Layer Performance Tracker
 * Tracks win rate per signal layer over the last 20 closed trades (per layer).
 * Auto-disables layers whose win rate falls below 30% (min 5 trades).
 * Re-enables after 24h or manual reset.
 */

export interface LayerStats {
  layer: string;
  totalTrades: number; // in last-20 window
  wins: number;
  losses: number;
  winRate: number; // 0-100
  totalPnl: number;
  disabled: boolean;
  disabledAt: number | null;
  disabledReason: string | null;
}

const MIN_TRADES_FOR_DISABLE = 5;
const DISABLE_WIN_RATE = 30; // %
const REENABLE_AFTER_MS = 24 * 60 * 60 * 1000;

// Per-session state: sessionToken → (layer → state)
const manualOverridesBySession = new Map<string, Map<string, boolean>>();
const autoDisabledBySession = new Map<string, Map<string, { at: number; reason: string }>>();

function getManualOverrides(sessionToken: string): Map<string, boolean> {
  if (!manualOverridesBySession.has(sessionToken)) manualOverridesBySession.set(sessionToken, new Map());
  return manualOverridesBySession.get(sessionToken)!;
}
function getAutoDisabled(sessionToken: string): Map<string, { at: number; reason: string }> {
  if (!autoDisabledBySession.has(sessionToken)) autoDisabledBySession.set(sessionToken, new Map());
  return autoDisabledBySession.get(sessionToken)!;
}

export function computeLayerStats(
  closedTrades: Array<{ signalReason: string | null; pnl: number | null; exitedAt: Date | null }>,
  sessionToken: string = "default",
): LayerStats[] {
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  // Reverse if newest-first (router passes desc order) — we need oldest-first for correct slice(-20)
  const first = closedTrades[0]?.exitedAt;
  const last = closedTrades[closedTrades.length - 1]?.exitedAt;
  const sorted = closedTrades.length > 1 && first && last && first > last
    ? [...closedTrades].reverse()
    : closedTrades;

  // Extract layer from signalReason — known layers used by the engine:
  const layerPatterns: Array<{ layer: string; test: (r: string) => boolean }> = [
    { layer: "Breakout", test: r => r.includes("Breakout") || r.includes("breakout") },
    { layer: "Supertrend", test: r => r.includes("Supertrend") },
    { layer: "MACD/BB", test: r => r.includes("MACD") || r.includes("BB") || r.includes("Bollinger") },
    { layer: "VWAPPullback", test: r => r.includes("VWAPPullback") },
    { layer: "ORB", test: r => r.includes("ORB") || r.includes("Opening Range") },
    { layer: "VWAP", test: r => r.includes("VWAP") },
    { layer: "EMA Cross", test: r => r.includes("EMA") },
    { layer: "TrendMomentum", test: r => r.includes("Momentum") || r.includes("momentum") || r.includes("TrendMomentum") },
    { layer: "Power Hour", test: r => r.includes("Power Hour") || r.includes("POWER") },
    { layer: "MCX Evening", test: r => r.includes("MCX") },
    { layer: "Hero Zero", test: r => r.includes("Hero") },
    { layer: "S/R Pivot", test: r => r.includes("Pivot") || r.includes("S/R") },
    { layer: "Institutional", test: r => r.includes("Institutional") || r.includes("footprint") },
    { layer: "Regime", test: r => r.includes("Regime") || r.includes("regime") },
    { layer: "PremiumRenko", test: r => r.includes("PremiumRenko") || r.includes("Premium Renko") },
  ];

  const byLayer = new Map<string, Array<{ pnl: number }>>();
  for (const t of sorted) {
    if (t.pnl === null || t.pnl === undefined) continue;
    const reason = t.signalReason ?? "";
    let matched = "Other";
    for (const p of layerPatterns) {
      if (p.test(reason)) { matched = p.layer; break; }
    }
    if (!byLayer.has(matched)) byLayer.set(matched, []);
    byLayer.get(matched)!.push({ pnl: t.pnl });
  }

  const stats: LayerStats[] = [];
  for (const [layer, trades] of Array.from(byLayer.entries())) {
    // Strictly last 20 trades per layer
    const last20 = trades.slice(-20);
    const wins = last20.filter(t => t.pnl > 0).length;
    const losses = last20.filter(t => t.pnl <= 0).length;
    const winRate = last20.length > 0 ? (wins / last20.length) * 100 : 0;
    const totalPnl = last20.reduce((s, t) => s + t.pnl, 0);

    // Auto-disable logic
    let disabled = manualOverrides.get(layer) ?? false;
    let disabledAt: number | null = null;
    let disabledReason: string | null = disabled ? "Manually disabled" : null;

    const auto = autoDisabled.get(layer);
    if (auto && Date.now() - auto.at > REENABLE_AFTER_MS) {
      autoDisabled.delete(layer); // 24h re-enable
    } else if (auto) {
      disabled = true;
      disabledAt = auto.at;
      disabledReason = auto.reason;
    }

    if (!disabled && last20.length >= MIN_TRADES_FOR_DISABLE && winRate < DISABLE_WIN_RATE) {
      const reason = `Auto-disabled: win rate ${winRate.toFixed(0)}% < ${DISABLE_WIN_RATE}% over last ${last20.length} trades`;
      autoDisabled.set(layer, { at: Date.now(), reason });
      disabled = true;
      disabledAt = Date.now();
      disabledReason = reason;
    }

    stats.push({ layer, totalTrades: last20.length, wins, losses, winRate, totalPnl, disabled, disabledAt, disabledReason });
  }

  return stats.sort((a, b) => b.totalTrades - a.totalTrades);
}

/** Check if a signal layer is currently disabled (called before entry) */
export function isLayerDisabled(layer: string, sessionToken: string = "default"): { disabled: boolean; reason: string | null } {
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  if (manualOverrides.get(layer)) return { disabled: true, reason: "Manually disabled" };
  const auto = autoDisabled.get(layer);
  if (auto) {
    if (Date.now() - auto.at > REENABLE_AFTER_MS) {
      autoDisabled.delete(layer);
      return { disabled: false, reason: null };
    }
    return { disabled: true, reason: auto.reason };
  }
  return { disabled: false, reason: null };
}

export function setLayerOverride(layer: string, disabled: boolean, sessionToken: string = "default"): void {
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  if (disabled) manualOverrides.set(layer, true);
  else { manualOverrides.delete(layer); autoDisabled.delete(layer); }
}

export function resetAllLayerOverrides(sessionToken: string = "default"): void {
  const manualOverrides = getManualOverrides(sessionToken);
  const autoDisabled = getAutoDisabled(sessionToken);
  manualOverrides.clear();
  autoDisabled.clear();
}
