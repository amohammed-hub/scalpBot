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

// Manual disable overrides (layer → disabled)
const manualOverrides = new Map<string, boolean>();
const autoDisabled = new Map<string, { at: number; reason: string }>();

export function computeLayerStats(
  closedTrades: Array<{ signalReason: string | null; pnl: number | null; exitedAt: Date | null }>,
): LayerStats[] {
  // Extract layer from signalReason — trades store the layer in signalReason.
  // Known layers used by the engine:
  const layerPatterns: Array<{ layer: string; test: (r: string) => boolean }> = [
    { layer: "ORB", test: r => r.includes("ORB") || r.includes("Opening Range") },
    { layer: "VWAP", test: r => r.includes("VWAP") },
    { layer: "EMA Cross", test: r => r.includes("EMA") },
    { layer: "Momentum", test: r => r.includes("Momentum") || r.includes("momentum") },
    { layer: "Power Hour", test: r => r.includes("Power Hour") || r.includes("POWER") },
    { layer: "MCX Evening", test: r => r.includes("MCX") },
    { layer: "Hero Zero", test: r => r.includes("Hero") },
    { layer: "S/R Pivot", test: r => r.includes("Pivot") || r.includes("S/R") },
    { layer: "Institutional", test: r => r.includes("Institutional") || r.includes("footprint") },
    { layer: "Regime", test: r => r.includes("Regime") || r.includes("regime") },
  ];

  const byLayer = new Map<string, Array<{ pnl: number }>>();
  for (const t of closedTrades) {
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
export function isLayerDisabled(layer: string): { disabled: boolean; reason: string | null } {
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

export function setLayerOverride(layer: string, disabled: boolean): void {
  if (disabled) manualOverrides.set(layer, true);
  else { manualOverrides.delete(layer); autoDisabled.delete(layer); }
}

export function resetAllLayerOverrides(): void {
  manualOverrides.clear();
  autoDisabled.clear();
}
