export interface PremiumCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface PremiumMomentumConfig {
  breakoutLookback: number;
  atrPeriod: number;
  fastEmaPeriod: number;
  slowEmaPeriod: number;
  minBodyRatio: number;
  minVolumeRatio: number;
  minBreakoutAtr: number;
  minMomentumAtr: number;
  stopAtrMultiplier: number;
  stopPercent: number;
  rewardRisk: number;
  maxSpreadPercent: number;
}

export interface PremiumChainStrike {
  strike: number;
  ceLtp: number;
  peLtp: number;
  ceToken: string | null;
  peToken: string | null;
}

export function selectPremiumChainCandidates(
  strikes: PremiumChainStrike[],
  underlyingPrice: number,
  maxPerSide = 3,
): Array<{ token: string; symbol: string; optionType: "CE" | "PE"; strike: number; premium: number }> {
  const ordered = [...strikes].sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice));
  const calls = ordered.filter(s => s.strike >= underlyingPrice && s.ceToken && finitePositive(s.ceLtp)).slice(0, Math.max(1, maxPerSide));
  const puts = ordered.filter(s => s.strike <= underlyingPrice && s.peToken && finitePositive(s.peLtp)).slice(0, Math.max(1, maxPerSide));
  return [
    ...calls.map(s => ({ token: s.ceToken!, symbol: `CE_${s.strike}`, optionType: "CE" as const, strike: s.strike, premium: s.ceLtp })),
    ...puts.map(s => ({ token: s.peToken!, symbol: `PE_${s.strike}`, optionType: "PE" as const, strike: s.strike, premium: s.peLtp })),
  ];
}

export interface PremiumCandidateQuote {
  token: string;
  symbol: string;
  optionType: "CE" | "PE";
  strike: number;
  premium: number;
  spreadPercent: number | null;
  timestamp: number;
}

export interface PremiumMomentumSignal {
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  target: number;
  atr: number;
  breakoutLevel: number;
  bodyRatio: number;
  volumeRatio: number | null;
  fastEma: number;
  slowEma: number;
  confidence: number;
}

export interface PremiumFirstScanResult {
  candidate: PremiumCandidateQuote;
  signal: PremiumMomentumSignal | null;
  reason: string;
}

export const DEFAULT_PREMIUM_MOMENTUM_CONFIG: PremiumMomentumConfig = {
  breakoutLookback: 5,
  atrPeriod: 14,
  fastEmaPeriod: 9,
  slowEmaPeriod: 21,
  minBodyRatio: 0.55,
  minVolumeRatio: 1.2,
  minBreakoutAtr: 0.15,
  minMomentumAtr: 0.5,
  stopAtrMultiplier: 1.2,
  stopPercent: 0.02,
  rewardRisk: 2,
  maxSpreadPercent: 0.08,
};

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function calculateAtr(candles: PremiumCandle[], period: number): number {
  if (candles.length < 2) return 0;
  const start = Math.max(1, candles.length - period);
  const ranges: number[] = [];
  for (let i = start; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  return ranges.length > 0 ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
}

export function calculateEma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const alpha = 2 / (period + 1);
  let result = values[0];
  for (let i = 1; i < values.length; i += 1) result = values[i] * alpha + result * (1 - alpha);
  return result;
}

export function generatePremiumMomentumSignal(
  candles: PremiumCandle[],
  spreadPercent: number | null = null,
  config: PremiumMomentumConfig = DEFAULT_PREMIUM_MOMENTUM_CONFIG,
): PremiumMomentumSignal | null {
  const minimum = Math.max(config.slowEmaPeriod, config.atrPeriod + 1, config.breakoutLookback + 2);
  if (candles.length < minimum) return null;
  if (spreadPercent !== null && (!Number.isFinite(spreadPercent) || spreadPercent > config.maxSpreadPercent)) return null;

  const current = candles[candles.length - 1];
  const previous = candles.slice(0, -1);
  const priorRange = previous.slice(-config.breakoutLookback);
  const priorHigh = Math.max(...priorRange.map(candle => candle.high));
  const priorLow = Math.min(...priorRange.map(candle => candle.low));
  const atr = calculateAtr(candles, config.atrPeriod);
  if (!finitePositive(atr) || !finitePositive(current.close)) return null;

  const range = current.high - current.low;
  if (!finitePositive(range)) return null;
  const bodyRatio = Math.abs(current.close - current.open) / range;
  if (bodyRatio < config.minBodyRatio) return null;

  const volumes = previous.slice(-config.atrPeriod).map(candle => candle.volume ?? 0).filter(volume => volume > 0);
  const volumeRatio = volumes.length >= 3
    ? (current.volume ?? 0) / (volumes.reduce((sum, value) => sum + value, 0) / volumes.length)
    : null;
  if (volumeRatio !== null && volumeRatio < config.minVolumeRatio) return null;

  const closes = candles.map(candle => candle.close);
  const fastEma = calculateEma(closes, config.fastEmaPeriod);
  const slowEma = calculateEma(closes, config.slowEmaPeriod);
  const momentum = current.close - previous[previous.length - 1].close;
  const breakoutBuffer = atr * config.minBreakoutAtr;
  const minMomentum = atr * config.minMomentumAtr;

  let direction: "BUY" | "SELL" | null = null;
  let breakoutLevel = 0;
  if (current.close > priorHigh + breakoutBuffer && momentum >= minMomentum && fastEma > slowEma) {
    direction = "BUY";
    breakoutLevel = priorHigh;
  } else if (current.close < priorLow - breakoutBuffer && momentum <= -minMomentum && fastEma < slowEma) {
    direction = "SELL";
    breakoutLevel = priorLow;
  }
  if (!direction) return null;

  const entry = current.close;
  const stopDistance = Math.max(atr * config.stopAtrMultiplier, entry * config.stopPercent);
  const stopLoss = direction === "BUY" ? entry - stopDistance : entry + stopDistance;
  const target = direction === "BUY"
    ? entry + stopDistance * config.rewardRisk
    : entry - stopDistance * config.rewardRisk;
  const confidence = Math.min(0.95, 0.55 + bodyRatio * 0.2 + Math.min(Math.abs(momentum) / atr, 2) * 0.1 + (volumeRatio !== null ? Math.min(volumeRatio / 10, 0.1) : 0));

  return { direction, entry, stopLoss, target, atr, breakoutLevel, bodyRatio, volumeRatio, fastEma, slowEma, confidence };
}

export function selectMomentumScalperWinner(
  scans: PremiumFirstScanResult[],
  minConfidence: number,
): PremiumFirstScanResult | null {
  return scans.find(result => result.signal
    && result.signal.direction === "BUY"
    && result.signal.confidence >= minConfidence) ?? null;
}

export function scanPremiumFirstCandidates(
  quotes: PremiumCandidateQuote[],
  histories: Map<string, PremiumCandle[]>,
  now: number,
  maxCandidates = 12,
  config: PremiumMomentumConfig = DEFAULT_PREMIUM_MOMENTUM_CONFIG,
): PremiumFirstScanResult[] {
  const ordered = [...quotes]
    .filter(q => q.token && finitePositive(q.premium) && q.timestamp <= now && now - q.timestamp <= 15_000)
    .sort((a, b) => b.premium - a.premium)
    .slice(0, Math.max(1, Math.min(maxCandidates, 20)));
  return ordered.map(candidate => {
    const history = histories.get(candidate.token) ?? [];
    const previousPremium = history[history.length - 1]?.close ?? candidate.premium;
    const nextHistory = [...history, {
      timestamp: candidate.timestamp,
      open: previousPremium,
      high: Math.max(previousPremium, candidate.premium),
      low: Math.min(previousPremium, candidate.premium),
      close: candidate.premium,
    }].slice(-120);
    histories.set(candidate.token, nextHistory);
    const signal = generatePremiumMomentumSignal(nextHistory, candidate.spreadPercent, config);
    return {
      candidate,
      signal,
      reason: signal ? `premium breakout ${candidate.optionType} ${candidate.strike}` : `warming/filtered ${candidate.optionType} ${candidate.strike}`,
    };
  });
}

export function simulatePremiumMomentum(
  candles: PremiumCandle[],
  spreadPercentByIndex: Map<number, number> = new Map(),
  config: PremiumMomentumConfig = DEFAULT_PREMIUM_MOMENTUM_CONFIG,
): Array<PremiumMomentumSignal & { entryIndex: number; exitIndex: number; exit: number; pnl: number; outcome: "TARGET" | "STOP" | "END" }> {
  const results: Array<PremiumMomentumSignal & { entryIndex: number; exitIndex: number; exit: number; pnl: number; outcome: "TARGET" | "STOP" | "END" }> = [];
  const minimum = Math.max(config.slowEmaPeriod, config.atrPeriod + 1, config.breakoutLookback + 2);
  let index = minimum;
  while (index < candles.length) {
    const signal = generatePremiumMomentumSignal(candles.slice(0, index + 1), spreadPercentByIndex.get(index) ?? null, config);
    if (!signal) {
      index += 1;
      continue;
    }
    let exitIndex = candles.length - 1;
    let exit = candles[exitIndex].close;
    let outcome: "TARGET" | "STOP" | "END" = "END";
    for (let next = index + 1; next < candles.length; next += 1) {
      const candle = candles[next];
      const stopHit = signal.direction === "BUY" ? candle.low <= signal.stopLoss : candle.high >= signal.stopLoss;
      const targetHit = signal.direction === "BUY" ? candle.high >= signal.target : candle.low <= signal.target;
      if (stopHit) {
        exitIndex = next; exit = signal.stopLoss; outcome = "STOP"; break;
      }
      if (targetHit) {
        exitIndex = next; exit = signal.target; outcome = "TARGET"; break;
      }
    }
    const pnl = signal.direction === "BUY" ? exit - signal.entry : signal.entry - exit;
    results.push({ ...signal, entryIndex: index, exitIndex, exit, pnl, outcome });
    index = exitIndex + 1;
  }
  return results;
}
